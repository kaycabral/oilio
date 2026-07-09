import type {
  CatalogItem,
  CatalogItemKind,
  CatalogItemUnitOverride,
  CommissionRule,
} from '@/domain'
import type { NameSearchResult, ProductMeasures } from '@cbrl/product'

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

export function normalizeKindFilter(value: string | undefined): 'all' | CatalogItemKind {
  if (value === 'service' || value === 'product') return value
  return 'all'
}

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

export interface ProductIntrinsics {
  readonly name: string
  readonly brand: string | null
  readonly description: string | null
  readonly photoUrl: string | null
  readonly measures: ProductMeasures | null
}

export type CodeLookupOutcome =
  | { readonly status: 'found'; readonly intrinsics: ProductIntrinsics }
  | { readonly status: 'new' }
  | { readonly status: 'unrecognized' }
  | { readonly status: 'unavailable' }

export type CodeFormState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'filled'
      readonly intrinsics: ProductIntrinsics
      readonly source: 'code' | 'name'
      readonly gtin14: string | null
    }
  | { readonly kind: 'contributing' }
  | { readonly kind: 'free'; readonly reason: 'unrecognized' | 'unavailable' }

export function deriveCodeState(outcome: CodeLookupOutcome): CodeFormState {
  switch (outcome.status) {
    case 'found':
      return { kind: 'filled', intrinsics: outcome.intrinsics, source: 'code', gtin14: null }
    case 'new':
      return { kind: 'contributing' }
    case 'unrecognized':
      return { kind: 'free', reason: 'unrecognized' }
    case 'unavailable':
      return { kind: 'free', reason: 'unavailable' }
  }
}

export interface ProductSuggestion {
  readonly value: string
  readonly name: string
  readonly brand: string | null
  readonly intrinsics: ProductIntrinsics
}

export const MIN_SEARCH_TERM_LENGTH = 3

export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function suggestionFromResult(result: NameSearchResult): ProductSuggestion {
  const { product } = result
  return {
    value: result.gtin14,
    name: product.name,
    brand: product.brand,
    intrinsics: {
      name: product.name,
      brand: product.brand,
      description: product.description,
      photoUrl: product.photoUrl,
      measures: product.measures,
    },
  }
}

export function filledFromSuggestion(suggestion: ProductSuggestion): CodeFormState {
  return {
    kind: 'filled',
    intrinsics: suggestion.intrinsics,
    source: 'name',
    gtin14: suggestion.value,
  }
}

export function referenceGtinToWire(state: CodeFormState): string | null {
  if (state.kind !== 'filled') return null
  return state.source === 'name' ? state.gtin14 : null
}

export function clearedCodeState(): CodeFormState {
  return { kind: 'idle' }
}

export function intrinsicsLocked(state: CodeFormState): boolean {
  return state.kind === 'filled'
}

export function nameIsContribution(state: CodeFormState): boolean {
  return state.kind === 'contributing'
}

export function normalizeCodeInput(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '')
}

export function codeNotice(state: CodeFormState): string | null {
  if (state.kind !== 'free') return null
  return state.reason === 'unavailable'
    ? 'Não foi possível consultar a base agora — você pode preencher os dados normalmente.'
    : 'Código não reconhecido — preencha os dados do produto normalmente.'
}
