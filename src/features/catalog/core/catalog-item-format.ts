import type { CatalogItemUnitOverride, CommissionRule, StoredUnit } from '@/domain'

export type CommissionKind = 'none' | 'percentage' | 'fixed'
export type OverrideCommissionKind = 'inherit' | 'none' | 'percentage' | 'fixed'

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
  none: 'Sem comissão',
  percentage: 'Percentual',
  fixed: 'Valor fixo',
}

export function formatCents(cents: number | undefined): string {
  if (cents === undefined) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

export function formatCommissionInput(c: CommissionRule | null | undefined): string {
  if (!c) return ''
  return c.kind === 'fixed' ? (c.value / 100).toFixed(2).replace('.', ',') : String(c.value)
}

export function commissionKindFor(c: CommissionRule | null | undefined): CommissionKind {
  if (c == null) return 'none'
  return c.kind
}

const OVERRIDE_COMMISSION_KINDS: readonly OverrideCommissionKind[] = [
  'inherit',
  'none',
  'percentage',
  'fixed',
]

export function isOverrideCommissionKind(value: string): value is OverrideCommissionKind {
  return (OVERRIDE_COMMISSION_KINDS as readonly string[]).includes(value)
}

export function overrideCommissionKindFor(
  override: CatalogItemUnitOverride,
): OverrideCommissionKind {
  if (override.commission === undefined) return 'inherit'
  if (override.commission === null) return 'none'
  return override.commission.kind
}

export function resolveDefaultNewUnitIds(
  activeUnitId: string | null,
  units: StoredUnit[],
): string[] {
  if (activeUnitId != null) return [activeUnitId]
  if (units.length === 1) return [units[0]!.id]
  return []
}
