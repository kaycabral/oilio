// Pure formatting/derivation for the catalog item form, extracted from the
// 'use client' component (Functional Core / Imperative Shell) so the
// cents/commission formatters, commission-kind derivations and the new-item
// default unit resolution are importable + unit-tested. No React, no I/O.

import type { CatalogItemUnitOverride, CommissionRule, StoredUnit } from '@/domain'

export type CommissionKind = 'none' | 'percentage' | 'fixed'
export type OverrideCommissionKind = 'inherit' | 'none' | 'percentage' | 'fixed'

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
  none: 'Sem comissão',
  percentage: 'Percentual',
  fixed: 'Valor fixo',
}

// Cents → "1234,56" (pt-BR decimal, comma). Undefined → empty (blank inherits).
export function formatCents(cents: number | undefined): string {
  if (cents === undefined) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

// A commission rule → its editable input value: fixed shows reais (cents/100),
// percentage shows the raw percent. Null/absent → empty.
export function formatCommissionInput(c: CommissionRule | null | undefined): string {
  if (!c) return ''
  return c.kind === 'fixed' ? (c.value / 100).toFixed(2).replace('.', ',') : String(c.value)
}

export function commissionKindFor(c: CommissionRule | null | undefined): CommissionKind {
  if (c == null) return 'none'
  return c.kind
}

// 'inherit' when the override leaves commission unset (undefined), 'none' when
// it explicitly clears it (null), else the override's own kind.
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

// A NEW item pre-checks the active unit (or the sole unit when the org has
// exactly one); empty when neither resolves. Edits ignore this (they keep
// `item.unitIds`).
export function resolveDefaultNewUnitIds(
  activeUnitId: string | null,
  units: StoredUnit[],
): string[] {
  if (activeUnitId != null) return [activeUnitId]
  if (units.length === 1) return [units[0]!.id]
  return []
}
