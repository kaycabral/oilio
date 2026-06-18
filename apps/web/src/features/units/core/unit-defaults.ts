// Functional core: prefilled defaults for the guided first-unit form (PRD
// Identidade v2 / brief 0046). The first-unit empty-state reduces friction by
// pre-filling everything it can deduce — the owner effectively only confirms
// the address + WhatsApp. Pure: no I/O, no React.

import { type BusinessHours, EMPTY_BUSINESS_HOURS } from '@/domain'

// A sensible default operating week for a new establishment: Monday–Saturday
// 09:00–18:00, Sunday closed. Editable in the form — this is just the seed so
// the owner doesn't start from an all-closed week. Returns a fresh object on
// each call (no shared mutable reference leaking into the form state).
export function defaultFirstUnitHours(): BusinessHours {
  const weekday = [{ open: '09:00', close: '18:00' }]
  return {
    ...EMPTY_BUSINESS_HOURS,
    monday: [...weekday],
    tuesday: [...weekday],
    wednesday: [...weekday],
    thursday: [...weekday],
    friday: [...weekday],
    saturday: [...weekday],
    sunday: null,
  }
}

// The unit name defaults to the Negócio (Org) name — the owner can rename it,
// but a single-unit business rarely needs a distinct unit name, so prefilling
// removes a field. Trimmed; empty org name yields an empty default (the form's
// own `required`/minLength still gates submission).
export function defaultFirstUnitName(orgName: string): string {
  return orgName.trim()
}
