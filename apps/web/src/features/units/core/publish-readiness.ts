// Functional core for per-unit self-booking publish readiness (brief 0008 #988,
// now per-unit — PRD Identidade v2, context 3). The adapter does the reads; this
// pure decision turns the three boolean facts into the missing[] requirement
// list. Keeping it pure makes the gate unit-testable without infra.
//
// The "is the unit publicly live" invariant itself (`isUnitPubliclyLive` and its
// helpers `unitHasAddressAndHours`/`unitHasUsableHours`) lives in `@/domain` — it
// is the single source of truth shared by the landing/slots, the client invite,
// the booking wizard and the `public_visible` projection. Re-exported here for
// the feature's existing import sites.
export { isUnitPubliclyLive, unitHasAddressAndHours, unitHasUsableHours } from '@/domain'

export type UnitPublishReadiness = { ready: boolean; missing: string[] }

// User-facing requirement copy (pt-BR). Mirrored by `UnitPublishCard`'s
// feedback list so the owner sees the same wording.
export const UNIT_REQUIREMENTS = {
  address: 'Endereço e horário de funcionamento preenchidos',
  service: '1 serviço público oferecido nesta unidade',
  memberOperation: '1 profissional aprovado nesta unidade',
} as const

// Compute the publish readiness from the three facts the adapter resolves.
export function computeUnitPublishReadiness(facts: {
  hasAddressAndHours: boolean
  hasPublicService: boolean
  hasOperationalMemberOperation: boolean
}): UnitPublishReadiness {
  const missing: string[] = []
  if (!facts.hasAddressAndHours) missing.push(UNIT_REQUIREMENTS.address)
  if (!facts.hasPublicService) missing.push(UNIT_REQUIREMENTS.service)
  if (!facts.hasOperationalMemberOperation) missing.push(UNIT_REQUIREMENTS.memberOperation)
  return { ready: missing.length === 0, missing }
}
