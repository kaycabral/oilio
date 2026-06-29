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

// Progressive profiling (brief 0077 Grupo C — AC-08/AC-09, #1277). The
// completion step pre-fills whatever the identity already gives us (name + email
// from the Google OAuth profile, plus any whatsapp/birthDate a returning user
// already has) and only *highlights* what's still missing. Pre-filled fields stay
// editable — this drives copy + focus, not validation (the server still parses
// every field). Pure: derived from the User snapshot, no I/O.

// The identity facts available to pre-fill the completion form. Mirrors the
// subset of `User` the page resolves (OAuth display name/email + any prior PII).
export type ProfileKnownFacts = {
  name: string | null
  email: string | null
  whatsapp: string | null
  birthDate: string | null
}

export type ProfilePrefill = {
  name: string
  email: string
  whatsapp: string
  birthDate: string
  // The fields the customer still has to provide (empty in the known facts).
  // Drives the "só o que falta" copy + initial focus; everything renders, but
  // these are the ones the customer actually needs to touch.
  missing: Array<'name' | 'whatsapp' | 'birthDate'>
}

// Required completion fields, in render order. Email is captured from OAuth and
// not a hard requirement of `parseProfileForm`, so it's not in this list.
const REQUIRED_FIELDS = ['name', 'whatsapp', 'birthDate'] as const

export function deriveProfilePrefill(facts: ProfileKnownFacts): ProfilePrefill {
  const name = facts.name?.trim() ?? ''
  const whatsapp = facts.whatsapp?.trim() ?? ''
  const birthDate = facts.birthDate?.trim() ?? ''
  const present: Record<(typeof REQUIRED_FIELDS)[number], boolean> = {
    name: name.length >= 2,
    whatsapp: whatsapp.length > 0,
    birthDate: birthDate.length > 0,
  }
  return {
    name,
    email: facts.email?.trim() ?? '',
    whatsapp,
    birthDate,
    missing: REQUIRED_FIELDS.filter((f) => !present[f]),
  }
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
