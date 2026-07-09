'use server'

import { changedProfileFields, parseProfileForm } from '@/features/settings/core/profile-form'
import { isUniqueViolation, USERS_MOBILE_UNIQUE } from '@/shared/db/pg/unique-violation'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { emitPiiEvent } from '@/shared/privacy/pii-events'

export type UpdateProfileResult = { ok: true } | { ok: false; error: string }

export async function updateProfile(formData: FormData): Promise<UpdateProfileResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }

  const user = await getUserById(session.uid)
  if (!user) return { ok: false, error: 'Usuário não encontrado' }
  if (user.anonymizedAt) return { ok: false, error: 'Conta anonimizada não pode ser editada' }

  const parsed = parseProfileForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const fieldsChanged = changedProfileFields(parsed, user)

  const now = new Date().toISOString()
  try {
    await patchUser(
      session.uid,
      {
        display_name: parsed.name,
        mobile: parsed.mobile,
        birth_date: parsed.birthDate,
      },
      now,
    )
  } catch (err) {
    if (isUniqueViolation(err, USERS_MOBILE_UNIQUE)) {
      return {
        ok: false,
        error:
          'Esse número de WhatsApp já está em uso por outra conta. Use o seu próprio número ou fale com o estabelecimento.',
      }
    }
    throw err
  }

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
