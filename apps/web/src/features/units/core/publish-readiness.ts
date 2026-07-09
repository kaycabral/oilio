export { isUnitPubliclyLive, unitHasAddressAndHours, unitHasUsableHours } from '@/domain'

export type UnitPublishReadiness = { ready: boolean; missing: string[] }

export const UNIT_REQUIREMENTS = {
  address: 'Endereço e horário de funcionamento preenchidos',
  service: '1 serviço público oferecido nesta unidade',
  memberOperation: '1 profissional aprovado nesta unidade',
} as const

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
