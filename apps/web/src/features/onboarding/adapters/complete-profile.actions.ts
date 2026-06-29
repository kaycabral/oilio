'use server'

import { parseProfileForm } from '@/features/onboarding/core/profile-form'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
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

  // No stub dedupe (brief 0077, Grupo C — #1276). The recepcionista no longer
  // creates stub Users by typing PII (the convite-contextual flow #1279 hands
  // out a link instead), so there is no stub to fold in. Folding-by-WhatsApp was
  // the SOURCE of the wrong-number breach the brief kills: a mistyped number on a
  // stub could silently capture a real login. Each login is its own user — no
  // merge. (Removed `findClaimableStubByWhatsapp` + `mergeStubUserIntoClaimer`.)

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
  // memberOperation's profile, but readiness is recomputed on the next enriched
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
