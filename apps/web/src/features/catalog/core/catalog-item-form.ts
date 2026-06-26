// Functional core for the catalog item form: pure FormData parsing of the
// commission rule + per-unit overrides, the list-surface filters, AND the
// product-code autofill state derivation (brief 0054). No I/O — the adapter
// (catalog.actions / the live-lookup action) does the Postgres lookup + writes;
// the ui component renders the derived state.

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

// ── Product-code autofill (brief 0054 § Grupo A/B/C/D) ───────────────────────
//
// The sovereign base speaks GTIN; the UX never does (AC-04). This section is the
// translation seam: it consumes the typed lookup outcome and exposes only
// product-language state (filled-from-base / needs-a-name / free) to the UI.

// The intrinsic attributes the base can fill into the form on a hit. Mirrors the
// shareable subset of the sovereign `Product` (never price/stock — those are the
// seller's, on the CatalogItem). Serializable across the server→client boundary.
export interface ProductIntrinsics {
  readonly name: string
  readonly brand: string | null
  readonly description: string | null
  readonly photoUrl: string | null
  readonly measures: ProductMeasures | null
}

// Result of the live lookup, in product language (no GTIN/SKU jargon leaks to
// the UI). Returned by the lookup action and fed to `deriveCodeState`:
//   - found        — the base knows this code; intrinsics come back, fields lock.
//   - new          — a valid, unknown code; the user contributes the name (miss).
//   - unrecognized — the code isn't a real product code (rejected by validation).
//   - unavailable  — the base couldn't be reached; degrade silently, never block.
export type CodeLookupOutcome =
  | { readonly status: 'found'; readonly intrinsics: ProductIntrinsics }
  | { readonly status: 'new' }
  | { readonly status: 'unrecognized' }
  | { readonly status: 'unavailable' }

// The form's derived state for the code field. Drives which intrinsic fields are
// locked (read-only, came from the base) vs editable, and whether the name is a
// required contribution.
//   - idle         — no code (or cleared): manual flow, everything editable, item
//                    stays self-contained (AC-09).
//   - filled       — hit: intrinsics locked + shown; user only completes
//                    price/stock (AC-02). Carries the values to render.
//   - contributing — miss: a valid unknown code; name is REQUIRED (the minimum
//                    contribution, AC-03), fields editable.
//   - free         — code present but not a real product code (unrecognized) OR
//                    base unavailable: never block — fall back to the manual flow,
//                    editable, with at most a soft, jargon-free notice (AC-08/09).
//
// `filled` carries WHICH boca filled it (`source`) and, when the boca is the name
// combobox (feature D), the reference key (`gtin14`). The two bocas — code (C) and
// name (D) — converge on this SAME state so the form has one source of truth; they
// differ only in where the reference key lives on save: the code boca keeps it in
// its own input, the name boca has no code typed, so the key rides on the state
// and the form wires it (a hidden `gtin`). On a code-path fill `gtin14` is null.
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

// Derive the form state from a CODE lookup outcome (boca C). The single source of
// the form's behaviour — the UI never branches on the outcome itself. A code hit
// fills with `source: 'code'`; the reference key stays in the code input, so
// `gtin14` on the state is null (the form must not also wire it).
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

// One suggestion the name combobox shows (feature D, brief 0055). Product-language
// only — the UI never sees `gtin14`/`StoredProduct`; it sees a label to render and
// an opaque `value` to echo back on selection. Mirrors the shareable intrinsics
// the base can fill, plus the reference key the save wires (invisible in UX).
export interface ProductSuggestion {
  // Opaque selection key — the canonical `gtin14`. Stable id for list keys + the
  // value the form wires to reference the product on save (never shown).
  readonly value: string
  // What the user reads in the list: the product name + light disambiguation.
  readonly name: string
  readonly brand: string | null
  // The intrinsics to fill (read-only) when this suggestion is chosen.
  readonly intrinsics: ProductIntrinsics
}

// The name combobox only consults the base from this many chars (AC-01/AC-05).
// MUST equal `@cbrl/product`'s `MIN_SEARCH_TERM_LENGTH` (the server gate) — kept
// as a local copy ON PURPOSE: this module is client-imported (the combobox hook),
// and importing the runtime value from `@cbrl/product` drags its barrel (the `pg`
// pool, server-only) into the client bundle. The server action imports the
// canonical constant directly; both are the same value, asserted by a unit test.
export const MIN_SEARCH_TERM_LENGTH = 3

// Normalize a search term the SAME way as `@cbrl/product`'s `normalizeSearchTerm`
// (collapse internal whitespace, trim, casefold) so the client gate is the exact
// predicate the server uses on borderline terms (e.g. "a  b" → "a b"). Duplicated
// for the same client-bundle reason as the constant above; kept in lockstep by a
// unit test that pins both against the canonical engine.
export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Map a sovereign-base name-search result to a UX suggestion (product language,
// no jargon). The boundary where `gtin14`/`StoredProduct` stop and the combobox's
// vocabulary begins — so the UI never imports the base's shape.
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

// Derive the filled state from a chosen NAME suggestion (boca D). Converges on the
// SAME `filled` state as a code hit (intrinsics locked, read-only) — but tags
// `source: 'name'` and carries the reference `gtin14`, because there is no code
// input to hold it: the form wires this key so the save references the product
// exactly like a code hit (AC-02).
export function filledFromSuggestion(suggestion: ProductSuggestion): CodeFormState {
  return {
    kind: 'filled',
    intrinsics: suggestion.intrinsics,
    source: 'name',
    gtin14: suggestion.value,
  }
}

// The reference key the form must wire as a hidden `gtin` so the save gate
// references the product — ONLY for a name-boca fill (the code boca keeps its key
// in its own input). Null in every other case, so the form renders no hidden
// input (and the two bocas never emit two `gtin` fields).
export function referenceGtinToWire(state: CodeFormState): string | null {
  if (state.kind !== 'filled') return null
  return state.source === 'name' ? state.gtin14 : null
}

// The empty/cleared state. Clearing or changing the code reverts the form here
// (AC-06) before a fresh lookup — no orphan locked fields left behind.
export function clearedCodeState(): CodeFormState {
  return { kind: 'idle' }
}

// Whether the intrinsic fields (name + base-owned attributes) are locked. Only a
// hit locks them — they came from the base and must stay a reference, not a copy
// (AC-02). Every other state leaves them editable.
export function intrinsicsLocked(state: CodeFormState): boolean {
  return state.kind === 'filled'
}

// Whether the current state requires the user to supply a name as a deliberate
// contribution. True only on a miss; a hit fills the name from the base, and
// idle/free rely on the ordinary `required` on the name input.
export function nameIsContribution(state: CodeFormState): boolean {
  return state.kind === 'contributing'
}

// Normalize the raw code input the same way for paste, manual typing and HID
// scan (AC-05): trim surrounding whitespace and drop the separators scanners and
// humans add. Mirrors the validator's own pre-clean so the preview and the save
// gate agree on the key (one source of truth). Returns '' for a blank field.
export function normalizeCodeInput(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '')
}

// Soft, jargon-free notice for the `free` state. Never names GTIN/SKU/barcode
// (AC-04); communicates only in product language. `null` when no notice applies.
export function codeNotice(state: CodeFormState): string | null {
  if (state.kind !== 'free') return null
  return state.reason === 'unavailable'
    ? 'Não foi possível consultar a base agora — você pode preencher os dados normalmente.'
    : 'Código não reconhecido — preencha os dados do produto normalmente.'
}
