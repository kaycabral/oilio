import {
  type AllowedTimeScope,
  BILLING_CYCLES,
  type BillingCycle,
  type BookingLimits,
  isValidTimeScopeHHmm,
  type UsageLimit,
} from '@/domain'

import { formCents, formString } from '@/shared/form-data'

export type PlanPayload = {
  name: string
  description: string | null
  priceCents: number
  billingCycle: BillingCycle
  includedItemIds: string[]
  includedCategoryIds: string[]
  usageLimit: UsageLimit
  unitAllowlist: string[] | undefined
  allowedTimeScope: AllowedTimeScope | undefined
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

  const priceCents = formCents(formData, 'priceCents')
  if (priceCents === null) return 'Preço inválido'

  const billingCycleRaw = formString(formData, 'billingCycle')
  if (!isBillingCycle(billingCycleRaw)) return 'Ciclo de cobrança inválido'
  const billingCycle: BillingCycle = billingCycleRaw

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

  const allowedTimeScope = parseAllowedTimeScope(formData)
  if (typeof allowedTimeScope === 'string') return allowedTimeScope

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
