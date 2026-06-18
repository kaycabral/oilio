// Functional core for per-unit self-booking publish readiness (brief 0008 #988,
// now per-unit — PRD Identidade v2, context 3). The adapter does the Firestore
// reads; this pure decision turns the three boolean facts into the missing[]
// requirement list. Keeping it pure makes the gate unit-testable without the
// emulator.

import type { Unit, UnitAgendaConfig } from '@/domain'
import { isBusinessHoursConfigured, isUnitBookable, unitBusinessHours } from '@/domain'

export type UnitPublishReadiness = { ready: boolean; missing: string[] }

// User-facing requirement copy (pt-BR). Mirrored by `UnitPublishCard`'s
// feedback list so the owner sees the same wording.
export const UNIT_REQUIREMENTS = {
  address: 'Endereço e horário de funcionamento preenchidos',
  service: '1 serviço público oferecido nesta unidade',
  professional: '1 profissional aprovado nesta unidade',
} as const

// A unit has usable hours when it's `always_open` (open by definition) or its
// agenda carries at least one open weekday. v2: the agenda always holds a
// `businessHours` object (never null), so the zero-value all-closed week
// (`EMPTY_BUSINESS_HOURS`) must NOT count as configured — defer to
// `isBusinessHoursConfigured`. Address is required on every unit by schema.
export function unitHasAddressAndHours(agenda: UnitAgendaConfig): boolean {
  return agenda.mode === 'always_open' || isBusinessHoursConfigured(unitBusinessHours(agenda))
}

// Whether a unit's public booking page is live. SPIKE (inferred availability):
// there is no stored publish flag / publish button — a unit goes public the
// moment it uses the online agenda (appointment mode) AND declares operating
// hours. Service/professional readiness is owner-facing FEEDBACK only and does
// NOT hard-gate the public page (an appointment unit with hours but no pro
// simply renders no bookable slots). PRD Identidade v2.
export function isUnitPubliclyLive(unit: Pick<Unit, 'agenda'>): boolean {
  return isUnitBookable(unit) && unitHasAddressAndHours(unit.agenda)
}

// Compute the publish readiness from the three facts the adapter resolves.
export function computeUnitPublishReadiness(facts: {
  hasAddressAndHours: boolean
  hasPublicService: boolean
  hasOperationalProfessional: boolean
}): UnitPublishReadiness {
  const missing: string[] = []
  if (!facts.hasAddressAndHours) missing.push(UNIT_REQUIREMENTS.address)
  if (!facts.hasPublicService) missing.push(UNIT_REQUIREMENTS.service)
  if (!facts.hasOperationalProfessional) missing.push(UNIT_REQUIREMENTS.professional)
  return { ready: missing.length === 0, missing }
}
