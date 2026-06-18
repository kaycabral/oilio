// Functional core for per-unit self-booking publish readiness (brief 0008 #988,
// now per-unit — PRD Identidade v2, context 3). The adapter does the Firestore
// reads; this pure decision turns the three boolean facts into the missing[]
// requirement list. Keeping it pure makes the gate unit-testable without the
// emulator.

import type { UnitAgendaConfig } from '@/domain'
import { unitBusinessHours } from '@/domain'

export type UnitPublishReadiness = { ready: boolean; missing: string[] }

// User-facing requirement copy (pt-BR). Mirrored by `UnitPublishCard`'s
// feedback list so the owner sees the same wording.
export const UNIT_REQUIREMENTS = {
  address: 'Endereço e horário de funcionamento preenchidos',
  service: '1 serviço público oferecido nesta unidade',
  professional: '1 profissional aprovado nesta unidade',
} as const

// A unit has usable hours when it's `always_open` (open by definition) or its
// agenda carries per-day ranges. Address is required on every unit by schema.
export function unitHasAddressAndHours(agenda: UnitAgendaConfig): boolean {
  return agenda.mode === 'always_open' || unitBusinessHours(agenda) != null
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
