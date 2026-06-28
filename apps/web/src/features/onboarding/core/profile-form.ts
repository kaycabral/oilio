// Functional core for the post-OAuth completion form (#838): pure parsing +
// validation of name/WhatsApp/birthDate into a typed payload (or a user-facing
// error string), plus the minimum-age rule. No I/O — the completeProfile adapter
// does the stub-dedupe, the user write, and the memberOperation re-derivation.

import { normalizeBrazilPhone, parseBirthDate } from '@/domain'
import { formString } from '@/shared/form-data'

export const MIN_AGE_YEARS = 13

export type ProfileFormPayload = {
  name: string
  whatsapp: string
  birthDate: string
}

export function parseProfileForm(formData: FormData): ProfileFormPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const whatsappRaw = formString(formData, 'whatsapp').trim()
  if (whatsappRaw.length === 0) return 'WhatsApp é obrigatório'
  const whatsapp = normalizeBrazilPhone(whatsappRaw)
  if (!whatsapp) return 'WhatsApp inválido'

  const birthDateResult = parseBirthDate(formString(formData, 'birthDate'))
  if (!birthDateResult.ok) return birthDateResult.error
  if (birthDateResult.value === null) return 'Data de nascimento é obrigatória'
  if (!meetsMinAge(birthDateResult.value, MIN_AGE_YEARS)) {
    return `Idade mínima ${MIN_AGE_YEARS} anos`
  }

  return { name, whatsapp, birthDate: birthDateResult.value }
}

// Returns true when `birthDate` is at least `minYears` ago. ISO `YYYY-MM-DD`.
export function meetsMinAge(
  birthDate: string,
  minYears: number,
  today: Date = new Date(),
): boolean {
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const cutoff = `${today.getFullYear() - minYears}-${todayIso.slice(5)}`
  return birthDate <= cutoff
}
