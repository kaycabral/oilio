import {
  type AllowedTimeScope,
  BILLING_CYCLES,
  type BillingCycle,
  type BookingLimits,
  isValidTimeScopeHHmm,
  type UsageLimit,
} from '@/domain'

import { formString } from '@/shared/form-data'

export type PlanPayload = {
  name: string
  description: string | null
  priceCents: number
  billingCycle: BillingCycle
  // FK array into CatalogItem.id (brief 0024, AC-01 — #1008). Canonical
  // per-item coverage of ANY kind. Selected via the item picker in PlanForm.
  // Existence is validated server-side against the org's `catalog_items`
  // (AC-03, defense in depth) before the event is emitted.
  includedItemIds: string[]
  // FK array into Category.id (brief 0023, AC-04 — #1003). Convenience coverage
  // ("all items of category X") alongside `includedItemIds` (brief 0024,
  // AC-02). Selected via a real category multi-select in PlanForm.
  includedCategoryIds: string[]
  usageLimit: UsageLimit
  // Spatial scope (brief 0019, Group A). `undefined` = no restriction
  // (all org units). Empty array would mean "no unit covered" which
  // would silently break self-book — the parser collapses empty to
  // `undefined` and the form guards by hiding the field until the
  // owner explicitly opts in.
  unitAllowlist: string[] | undefined
  // Temporal scope (brief 0019, Group B). `undefined` = unrestricted on
  // every axis. Sub-fields independently optional. The parser collapses
  // empty / non-positive inputs to `undefined` so reads never observe
  // a "nothing bookable" state.
  allowedTimeScope: AllowedTimeScope | undefined
  // Behavioral scope (brief 0019, Group C). `undefined` = no booking
  // limits. Sub-fields independently optional. Empty / non-positive
  // numeric inputs collapse to `undefined` on that axis so reads never
  // observe a meaningless zero.
  bookingLimits: BookingLimits | undefined
  active: boolean
}

function isBillingCycle(value: string): value is BillingCycle {
  return (BILLING_CYCLES as readonly string[]).includes(value)
}

export function parsePlanForm(formData: FormData): PlanPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const description = formString(formData, 'description').trim() || null

  const priceStr = formString(formData, 'priceCents').trim()
  const priceCents = Math.round(Number(priceStr.replace(',', '.')) * 100)
  if (!Number.isFinite(priceCents) || priceCents < 0) return 'Preço inválido'

  const billingCycleRaw = formString(formData, 'billingCycle')
  if (!isBillingCycle(billingCycleRaw)) return 'Ciclo de cobrança inválido'
  const billingCycle: BillingCycle = billingCycleRaw

  // Item + category coverage now ride as multi-value checkbox fields (one
  // value per selected id) — no more comma-split free text. `Set` dedupes
  // defensively.
  const includedItemIds = Array.from(
    new Set(
      formData
        .getAll('includedItemIds')
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((s) => s.length > 0),
    ),
  )
  const includedCategoryIds = Array.from(
    new Set(
      formData
        .getAll('includedCategoryIds')
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((s) => s.length > 0),
    ),
  )

  const limitKind = formString(formData, 'limitKind')
  let usageLimit: UsageLimit
  if (limitKind === 'unlimited') {
    usageLimit = { kind: 'unlimited' }
  } else if (limitKind === 'count') {
    const qty = Number(formData.get('limitQuantity'))
    if (!Number.isFinite(qty) || qty <= 0) return 'Quantidade de uso inválida'
    usageLimit = { kind: 'count', quantity: Math.round(qty) }
  } else {
    return 'Tipo de limite inválido'
  }

  const active = formData.get('active') === 'on'

  // Spatial scope (brief 0019, Group A — AC-01). Owner opts in via the
  // `restrictUnits` toggle; the per-unit checkboxes share the
  // `unitAllowlist` field. When the toggle is off we ignore any
  // lingering checkbox values to keep `undefined === all units` clean.
  const restrictUnits = formData.get('restrictUnits') === 'on'
  let unitAllowlist: string[] | undefined
  if (restrictUnits) {
    const raw = formData
      .getAll('unitAllowlist')
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
    if (raw.length === 0) return 'Selecione ao menos uma unidade ou desmarque a restrição'
    unitAllowlist = Array.from(new Set(raw))
  }

  // Temporal scope (brief 0019, Group B — AC-05). Three independent
  // toggles; absent toggles fall through to `undefined` on that axis.
  // Anything that would mean "nothing bookable" (empty days, inverted
  // hour range, zero advance window) is rejected loudly here rather
  // than silently passed to the snapshot.
  const allowedTimeScope = parseAllowedTimeScope(formData)
  if (typeof allowedTimeScope === 'string') return allowedTimeScope

  // Behavioral scope (brief 0019, Group C — AC-10). Single gate toggle;
  // when off, ignore all sub-field inputs.
  const bookingLimits = parseBookingLimits(formData)
  if (typeof bookingLimits === 'string') return bookingLimits

  return {
    name,
    description,
    priceCents,
    billingCycle,
    includedItemIds,
    includedCategoryIds,
    usageLimit,
    unitAllowlist,
    allowedTimeScope,
    bookingLimits,
    active,
  }
}

// Form parsers extraídos do actions.ts ('use server'). Next 15 / Turbopack
// rejeitam exports síncronos de arquivos 'use server' — Server Actions
// devem ser async. Os parsers continuam síncronos (puramente derivados
// do FormData), então moram aqui.

export function parseAllowedTimeScope(formData: FormData): AllowedTimeScope | undefined | string {
  const out: AllowedTimeScope = {}

  if (formData.get('restrictDaysOfWeek') === 'on') {
    const rawDays = formData.getAll('daysOfWeek').map((v) => Number(v))
    const days = Array.from(new Set(rawDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)))
    if (days.length === 0) {
      return 'Selecione ao menos um dia da semana ou desmarque a restrição'
    }
    days.sort((a, b) => a - b)
    out.daysOfWeek = days
  }

  if (formData.get('restrictHourRange') === 'on') {
    const start = formString(formData, 'hourRangeStart').trim()
    const end = formString(formData, 'hourRangeEnd').trim()
    if (!isValidTimeScopeHHmm(start) || !isValidTimeScopeHHmm(end)) {
      return 'Faixa horária inválida (use HH:mm)'
    }
    if (start >= end) {
      return 'A hora de início deve ser menor que a hora de término'
    }
    out.hourRange = { start, end }
  }

  if (formData.get('restrictAdvance') === 'on') {
    const raw = Number(formData.get('advanceBookingDays'))
    if (!Number.isFinite(raw) || raw <= 0) {
      return 'Janela de antecedência deve ser maior que zero'
    }
    out.advanceBookingDays = Math.round(raw)
  }

  return out.daysOfWeek == null && out.hourRange == null && out.advanceBookingDays == null
    ? undefined
    : out
}

// Coverage integrity (brief 0024, AC-03). Pure core of the server-side
// existence check: given the ids referenced by a plan's coverage and the sets
// of ids that actually exist under the org, returns a human-readable error
// for the FIRST dangling reference, or `null` when every ref resolves. The
// action wires the existing-id sets from Firestore reads; keeping the decision
// pure makes it unit-testable without the emulator.
export function findDanglingCoverageRef(
  includedItemIds: string[],
  includedCategoryIds: string[],
  existingItemIds: ReadonlySet<string>,
  existingCategoryIds: ReadonlySet<string>,
): string | null {
  for (const itemId of includedItemIds) {
    if (!existingItemIds.has(itemId)) {
      return `Item de catálogo inexistente na cobertura: ${itemId}`
    }
  }
  for (const categoryId of includedCategoryIds) {
    if (!existingCategoryIds.has(categoryId)) {
      return `Categoria inexistente na cobertura: ${categoryId}`
    }
  }
  return null
}

export function parseBookingLimits(formData: FormData): BookingLimits | undefined | string {
  if (formData.get('restrictBookingLimits') !== 'on') return undefined

  const out: BookingLimits = {}

  const rawMaxPerDay = formString(formData, 'maxPerDay').trim()
  if (rawMaxPerDay.length > 0) {
    const n = Number(rawMaxPerDay)
    if (!Number.isFinite(n) || n <= 0) {
      return 'Máximo por dia deve ser maior que zero'
    }
    out.maxPerDay = Math.round(n)
  }

  const rawMaxConcurrent = formString(formData, 'maxConcurrent').trim()
  if (rawMaxConcurrent.length > 0) {
    const n = Number(rawMaxConcurrent)
    if (!Number.isFinite(n) || n <= 0) {
      return 'Máximo de futuros simultâneos deve ser maior que zero'
    }
    out.maxConcurrent = Math.round(n)
  }

  if (formData.get('requireCompleteBeforeNext') === 'on') {
    out.requireCompleteBeforeNext = true
  }

  return out.maxPerDay == null &&
    out.maxConcurrent == null &&
    out.requireCompleteBeforeNext !== true
    ? undefined
    : out
}
