'use server'

import { mergeStubUserIntoClaimer } from '@/features/onboarding/adapters/user-merge'
import { parseProfileForm } from '@/features/onboarding/core/profile-form'
import { findClaimableStubByWhatsapp, getUserById, patchUser } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { toRoute } from '@/shared/routes'
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

  const user = await getUserById(session.uid)
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

  // #839 dedupe: a recepcionista may have already created a stub User for
  // this human (random uuid, `claimedAt: null`) when adding them to her
  // Customer book. If the WhatsApp matches, fold the stub into this OAuth
  // user — re-points every Customer/Membership/Appointment FK and deletes
  // the stub. Name from the completion form wins (data ownership — the
  // user is canonical, not the org's typed-in copy). When no stub
  // exists this is a normal new-user completion.
  const stubUid = await findClaimableStubByWhatsapp(whatsapp, session.uid)
  if (stubUid) {
    await mergeStubUserIntoClaimer({ stubUid, claimerUid: session.uid })
  }

  await patchUser(
    session.uid,
    {
      display_name: name,
      whatsapp,
      birth_date: birthDate,
      completion_completed: true,
    },
    now,
  )

  // No approval event to emit (#1226 AC-02): `operationalStatus` is derived on
  // read from real facts. Setting `User.whatsapp` above can complete a
  // professional's profile, but readiness is recomputed on the next enriched
  // read — there is nothing to materialize here.

  redirect(safeNext(formData.get('next')))
}

// Only accept same-origin paths so a tampered `next=` can't bounce the
// user off the app. Reject anything that isn't a leading-slash path.
function safeNext(raw: FormDataEntryValue | null): Route {
  if (typeof raw !== 'string') return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return toRoute(raw)
}
