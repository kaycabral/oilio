// Functional core for the catalog item form: pure FormData parsing of the
// commission rule + per-unit overrides, and the list-surface filters. No I/O —
// the adapter (catalog.actions) does the Firestore existence checks + writes.

import type {
  CatalogItem,
  CatalogItemKind,
  CatalogItemUnitOverride,
  CommissionRule,
} from '@/domain'

import { formString } from '@/shared/form-data'

export function parseCommissionFromForm(
  kindField: string,
  valueField: string,
  formData: FormData,
): CommissionRule | null | string {
  const kind = formString(formData, kindField)
  if (kind === '' || kind === 'none') return null
  if (kind !== 'percentage' && kind !== 'fixed') return 'Tipo de comissão inválido'
  const raw = Number(formString(formData, valueField).replace(',', '.'))
  if (!Number.isFinite(raw) || raw < 0) return 'Valor de comissão inválido'
  return { kind, value: kind === 'fixed' ? Math.round(raw * 100) : raw }
}

// Parse one unit's override fields (price / duration / commission). Returns an
// error string, or the override (empty when no field was filled for this unit).
export function parseSingleUnitOverride(
  formData: FormData,
  unitId: string,
): CatalogItemUnitOverride | string {
  const o: CatalogItemUnitOverride = {}
  const priceRaw = formString(formData, `override_${unitId}__priceCents`).trim()
  if (priceRaw.length > 0) {
    const v = Math.round(Number(priceRaw.replace(',', '.')) * 100)
    if (!Number.isFinite(v) || v < 0) return `Preço da exceção inválido (unit ${unitId})`
    o.priceCents = v
  }
  const durRaw = formString(formData, `override_${unitId}__durationMinutes`).trim()
  if (durRaw.length > 0) {
    const v = Number(durRaw)
    if (!Number.isFinite(v) || v <= 0 || v > 24 * 60) {
      return `Duração da exceção inválida (unit ${unitId})`
    }
    o.durationMinutes = Math.round(v)
  }
  const commissionKind = formString(formData, `override_${unitId}__commissionKind`)
  if (commissionKind.length > 0 && commissionKind !== 'inherit') {
    const c = parseCommissionFromForm(
      `override_${unitId}__commissionKind`,
      `override_${unitId}__commissionValue`,
      formData,
    )
    if (typeof c === 'string') return `${c} (unit ${unitId})`
    o.commission = c
  }
  return o
}

export function parseUnitOverrides(
  formData: FormData,
  unitIds: string[],
): Record<string, CatalogItemUnitOverride> | null | string {
  const out: Record<string, CatalogItemUnitOverride> = {}
  for (const unitId of unitIds) {
    const o = parseSingleUnitOverride(formData, unitId)
    if (typeof o === 'string') return o
    if (Object.keys(o).length > 0) out[unitId] = o
  }
  return Object.keys(out).length === 0 ? null : out
}

// URL search-param `kind` → the discrete filter the catalog list applies.
export function normalizeKindFilter(value: string | undefined): 'all' | CatalogItemKind {
  if (value === 'service' || value === 'product') return value
  return 'all'
}

// Pure list slice (brief 0023): filter the active catalog items by the selected
// kind + category. `categoryFilter === ''` = all; `'__none'` = uncategorized.
export function filterCatalogItems<T extends Pick<CatalogItem, 'kind' | 'categoryId'>>(
  items: T[],
  kindFilter: 'all' | CatalogItemKind,
  categoryFilter: string,
): T[] {
  return items.filter((it) => {
    if (kindFilter !== 'all' && it.kind !== kindFilter) return false
    if (categoryFilter === '') return true
    if (categoryFilter === '__none') return it.categoryId == null
    return it.categoryId === categoryFilter
  })
}
