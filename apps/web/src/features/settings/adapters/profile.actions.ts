'use server'

import { changedProfileFields, parseProfileForm } from '@/features/settings/core/profile-form'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { emitPiiEvent } from '@/shared/privacy/pii-events'

export type UpdateProfileResult = { ok: true } | { ok: false; error: string }

// Self-service rectification (brief 0032 / AC-06): the signed-in subject edits
// their own global `users/{uid}` profile. Identity is by reference everywhere
// (orders/commissions/agenda read the live name), so a single write reflects
// across every screen and org — no per-record fan-out. An anonymized account
// cannot rectify (the PII was irreversibly scrubbed; art. 12).
export async function updateProfile(formData: FormData): Promise<UpdateProfileResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }

  const user = await getUserById(session.uid)
  if (!user) return { ok: false, error: 'Usuário não encontrado' }
  if (user.anonymizedAt) return { ok: false, error: 'Conta anonimizada não pode ser editada' }

  const parsed = parseProfileForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Only the fields that actually changed go into `fields_changed` (names
  // only). The event carries NO values — just which fields were rectified.
  const fieldsChanged = changedProfileFields(parsed, user)

  const now = new Date().toISOString()
  // Merge-patch the global `users` doc (snake_case columns). Identity is by
  // reference everywhere, so this single write reflects across every screen/org.
  await patchUser(
    session.uid,
    {
      display_name: parsed.name,
      whatsapp: parsed.whatsapp,
      birth_date: parsed.birthDate,
    },
    now,
  )

  // `pii_rectified` (AC-07) — PII-free: opaque subject_ref + the NAMES of the
  // fields that changed (never their values). Rectification is global.
  if (fieldsChanged.length > 0) {
    await emitPiiEvent('pii_rectified', {
      orgId: user.currentOrgId,
      subjectRef: session.uid,
      scope: 'account',
      requestedBy: session.uid,
      fieldsChanged,
    })
  }

  return { ok: true }
}
