'use server'

import { StoredProfessional, User } from '@/domain'
import { deriveOperationalStatus, ProfessionalConfig } from '@/domain/aggregates'
import { mergeStubUserIntoClaimer } from '@/features/onboarding/adapters/user-merge'
import { parseProfileForm } from '@/features/onboarding/core/profile-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { toRoute } from '@/shared/routes'
import { getUserMemberships } from '@/shared/tenant/membership'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export type CompleteProfileResult = { ok: true } | { ok: false; error: string }

// Server action backing the post-OAuth completion step (#838). Captures
// what the OAuth identity doesn't give us (WhatsApp, birthDate) plus a
// name override. Idempotent: if the user already finished completion, the
// action refuses to overwrite — that gate also lives in the page render
// path, but server actions must defend themselves (don't trust the UI).
export async function completeProfile(formData: FormData): Promise<CompleteProfileResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }

  const userRef = getAdminFirestore()
    .collection('users')
    .withConverter(fsConverter(User))
    .doc(session.uid)
  const userSnap = await userRef.get()
  const user = userSnap.data()
  if (!user) return { ok: false, error: 'Usuário não encontrado' }
  if (user.completionCompleted) {
    // Idempotent — already done. Don't error; just fall through to the
    // redirect so a stale tab doesn't trap the user.
    redirect(safeNext(formData.get('next')))
  }

  const parsed = parseProfileForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }
  const { name, whatsapp, birthDate } = parsed

  const now = new Date().toISOString()
  const db = getAdminFirestore()

  // #839 dedupe: a recepcionista may have already created a stub User for
  // this human (random uuid, `claimedAt: null`) when adding them to her
  // Customer book. If the WhatsApp matches, fold the stub into this OAuth
  // user — re-points every Customer/Membership/Appointment FK and deletes
  // the stub. Name from the completion form wins (data ownership — the
  // user is canonical, not the tenant's typed-in copy). When no stub
  // exists this is a normal new-user completion.
  const stubMatches = await db
    .collection('users')
    .where('whatsapp', '==', whatsapp)
    .where('claimedAt', '==', null)
    .get()
  const stubUid = stubMatches.docs.find((d) => d.id !== session.uid)?.id ?? null
  if (stubUid) {
    await mergeStubUserIntoClaimer({ stubUid, claimerUid: session.uid })
  }

  await userRef.update({
    displayName: name,
    whatsapp,
    birthDate,
    completionCompleted: true,
    updatedAt: now,
  })

  // Derived approval (#1047 / AC-06/AC-07): setting `User.whatsapp` here can be
  // the missing fact that completes a professional's profile. Re-derive across
  // every professional projection linked to this user (a person may operate in
  // multiple tenants) and emit `professional.activated` where the profile is now
  // complete (whatsapp ∧ ≥1 unit ∧ ≥1 service). Event-first — no direct status
  // write. Best-effort: a failure here must not trap the user mid-onboarding,
  // so errors surface in logs but don't abort the redirect; the next
  // professional mutation re-derives.
  await activateCompletedProfessionalsFor(session.uid, whatsapp)

  redirect(safeNext(formData.get('next')))
}

// Re-derives `operationalStatus` for every professional projection linked to this
// user and emits `professional.activated` where the profile is now complete
// (#1047 / AC-07). Scoped via the user's active memberships (no cross-tenant
// product query — ADR 0004): only `role=professional` memberships matter.
// Event-first; no direct status write. Best-effort — a per-tenant failure is
// logged and skipped so onboarding never traps; the next professional mutation
// re-derives.
async function activateCompletedProfessionalsFor(uid: string, whatsapp: string): Promise<void> {
  const memberships = await getUserMemberships(uid)
  const proTenantIds = memberships.filter((m) => m.role === 'professional').map((m) => m.tenantId)
  if (proTenantIds.length === 0) return
  const db = getAdminFirestore()
  for (const tenantId of proTenantIds) {
    try {
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('professionals')
        .where('userId', '==', uid)
        .withConverter(fsConverter(StoredProfessional))
        .get()
      for (const doc of snap.docs) {
        const stored = doc.data()
        if (stored.operationalStatus === 'operational') continue
        const derived = deriveOperationalStatus({
          inviteAccepted: true,
          whatsapp,
          unitIds: stored.unitIds,
          serviceIds: stored.serviceIds,
        })
        if (derived !== 'operational') continue
        await emitEvent(ProfessionalConfig, `tenants/${tenantId}/professionals/${doc.id}`, {
          _tag: 'professional.activated',
          actorId: uid,
          payload: {},
        })
      }
    } catch (err) {
      console.error(`[completeProfile] approval derivation failed for tenant ${tenantId}`, err)
    }
  }
}

// Only accept same-origin paths so a tampered `next=` can't bounce the
// user off the app. Reject anything that isn't a leading-slash path.
function safeNext(raw: FormDataEntryValue | null): Route {
  if (typeof raw !== 'string') return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return toRoute(raw)
}
