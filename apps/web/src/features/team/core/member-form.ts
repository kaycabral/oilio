// Pure derivations + label maps for the member-detail form, extracted from the
// 'use client' component (Functional Core / Imperative Shell) so the commission
// formatter, initial-unit resolution and service-eligibility rule are
// importable + unit-tested. No React, no I/O.

import type { MemberOperation, Role } from '@/domain'

export type TaxKind = 'none' | 'individual' | 'company'
export type CommissionKind = 'none' | 'percentage' | 'fixed'

export const OPERATIONAL_LABELS: Record<MemberOperation['operationalStatus'], string> = {
  incomplete: 'Cadastro incompleto',
  operational: 'Operacional',
}

// Roles assignable via the UI. `owner` is excluded (org-creator identity,
// never assigned by role-edit — same guard as the invite flow + the action).
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

// Format a stored commission rule for the value input: cents→"R$" digits for
// fixed, the raw percent for percentage, empty otherwise.
export function memberCommissionValue(
  commission: MemberOperation['defaultCommission'] | undefined,
): string {
  if (commission?.kind === 'fixed') return (commission.value / 100).toFixed(2).replace('.', ',')
  if (commission?.kind === 'percentage') return String(commission.value)
  return ''
}

// Initial unit selection (AC-03, brief 0039): keep the memberOperation's stored
// units as-is; pre-check the active unit only when they have none yet.
export function initialMemberUnitIds(
  memberOperation: Pick<MemberOperation, 'unitIds'> | null,
  activeUnitId: string | null,
): Set<string> {
  const existing = memberOperation?.unitIds ?? []
  if (existing.length > 0) return new Set(existing)
  return new Set(activeUnitId != null ? [activeUnitId] : [])
}

// A service is eligible for a memberOperation when it is offered in at least one of
// the memberOperation's selected units (unit intersection). Preserves the input
// element type so callers keep name/category for rendering.
export function computeEligibleServices<T extends { unitIds?: string[] }>(
  services: T[],
  selectedUnitIds: Set<string>,
): T[] {
  return services.filter((svc) => (svc.unitIds ?? []).some((u) => selectedUnitIds.has(u)))
}
