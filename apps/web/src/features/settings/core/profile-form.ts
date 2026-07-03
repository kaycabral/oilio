// Functional core for the self-service profile rectification form (brief 0032 /
// AC-06): pure parsing + validation of the submitted FormData into a typed
// payload (or a user-facing error string). No I/O — the adapter
// (profile.actions) does the user read + write + PII event.

import { normalizeBrazilMobile, parseBirthDate } from '@/domain'
import { formString } from '@/shared/form-data'

export const MIN_AGE_YEARS = 13

export type ProfileFormPayload = {
  name: string
  mobile: string
  birthDate: string
}

export function parseProfileForm(formData: FormData): ProfileFormPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const mobileRaw = formString(formData, 'mobile').trim()
  if (mobileRaw.length === 0) return 'WhatsApp é obrigatório'
  const mobile = normalizeBrazilMobile(mobileRaw)
  if (!mobile) return 'WhatsApp inválido'

  const birthDateResult = parseBirthDate(formString(formData, 'birthDate'))
  if (!birthDateResult.ok) return birthDateResult.error
  if (birthDateResult.value === null) return 'Data de nascimento é obrigatória'
  if (!meetsMinAge(birthDateResult.value, MIN_AGE_YEARS)) {
    return `Idade mínima ${MIN_AGE_YEARS} anos`
  }

  return { name, mobile, birthDate: birthDateResult.value }
}

// True when `birthDate` is at least `minYears` ago. ISO `YYYY-MM-DD`.
export function meetsMinAge(
  birthDate: string,
  minYears: number,
  today: Date = new Date(),
): boolean {
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const cutoff = `${today.getFullYear() - minYears}-${todayIso.slice(5)}`
  return birthDate <= cutoff
}

// Names of the fields whose value actually changed vs the current profile. The
// PII event carries field NAMES only, never their values (AC-07).
export function changedProfileFields(
  payload: ProfileFormPayload,
  current: { displayName?: string | null; mobile?: string | null; birthDate?: string | null },
): string[] {
  const fieldsChanged: string[] = []
  if (payload.name !== (current.displayName ?? '')) fieldsChanged.push('displayName')
  if (payload.mobile !== (current.mobile ?? '')) fieldsChanged.push('mobile')
  if (payload.birthDate !== (current.birthDate ?? '')) fieldsChanged.push('birthDate')
  return fieldsChanged
}
