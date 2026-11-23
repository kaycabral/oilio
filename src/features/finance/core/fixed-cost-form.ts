import type { FixedCostCategory } from '@/domain'
import { FIXED_COST_NAME_MAX, FIXED_COST_NAME_MIN, isFixedCostCategory } from '@/domain'

import { formString } from '@/shared/form-data'

export type FixedCostFormPayload = {
  name: string
  category: FixedCostCategory
  amountCents: number
  effectiveFromMonth: string
}

export function parseFixedCostForm(
  formData: FormData,
  now: Date = new Date(),
): FixedCostFormPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < FIXED_COST_NAME_MIN) return 'Nome é obrigatório'
  if (name.length > FIXED_COST_NAME_MAX) return `Nome muito longo (máx. ${FIXED_COST_NAME_MAX})`

  const category = formString(formData, 'category').trim()
  if (!isFixedCostCategory(category)) return 'Categoria inválida'

  const amountCents = parseAmountToCents(formString(formData, 'amount'))
  if (amountCents === null) return 'Valor inválido'
  if (amountCents < 1) return 'Valor deve ser maior que zero'

  const effectiveFromMonth = parseEffectiveFromMonth(formString(formData, 'effectiveFrom'), now)
  if (effectiveFromMonth === null) return 'Vigência inválida'

  return { name, category, amountCents, effectiveFromMonth }
}

export function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

export function parseEffectiveFromMonth(raw: string, now: Date = new Date()): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return monthLabel(now.getUTCFullYear(), now.getUTCMonth() + 1)
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (monthMatch) {
    const year = Number(monthMatch[1])
    const month = Number(monthMatch[2])
    if (month < 1 || month > 12) return null
    return monthLabel(year, month)
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return monthLabel(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1)
}

function monthLabel(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}
