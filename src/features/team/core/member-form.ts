import type { MemberOperation, Role } from '@/domain'
import { formatAmountFromCents } from '@cbrl/br/money'

export type TaxKind = 'none' | 'individual' | 'company'
export type CommissionKind = 'none' | 'percentage' | 'fixed'

export const OPERATIONAL_LABELS: Record<MemberOperation['operationalStatus'], string> = {
  incomplete: 'Cadastro incompleto',
  operational: 'Operacional',
}

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'member_operator', label: 'Profissional' },
  { value: 'receptionist', label: 'Recepção' },
  { value: 'manager', label: 'Gerente' },
]

export const TAX_KIND_LABELS: Record<TaxKind, string> = {
  none: 'Sem informar',
  individual: 'Pessoa física',
  company: 'Pessoa jurídica',
}

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
  none: 'Sem comissão',
  percentage: 'Percentual',
  fixed: 'Valor fixo',
}

export function memberCommissionValue(
  commission: MemberOperation['defaultCommission'] | undefined,
): string {
  if (commission?.kind === 'fixed') return formatAmountFromCents(commission.value)
  if (commission?.kind === 'percentage') return String(commission.value)
  return ''
}

export function initialMemberUnitIds(
  memberOperation: Pick<MemberOperation, 'unitIds'> | null,
  activeUnitId: string | null,
): Set<string> {
  const existing = memberOperation?.unitIds ?? []
  if (existing.length > 0) return new Set(existing)
  return new Set(activeUnitId != null ? [activeUnitId] : [])
}

export function computeEligibleServices<T extends { unitIds?: string[] }>(
  services: T[],
  selectedUnitIds: Set<string>,
): T[] {
  return services.filter((svc) => (svc.unitIds ?? []).some((u) => selectedUnitIds.has(u)))
}
