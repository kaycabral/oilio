import { describe, expect, it } from 'vitest'

import { parseAmountToCents, parseEffectiveFromMonth, parseFixedCostForm } from './fixed-cost-form'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('parseFixedCostForm', () => {
  it('parses a valid fixed cost (AC-01)', () => {
    const parsed = parseFixedCostForm(
      form({
        name: 'Aluguel',
        category: 'expense_admin',
        amount: '2.000,00',
        effectiveFrom: '2026-07',
      }),
    )
    expect(parsed).toEqual({
      name: 'Aluguel',
      category: 'expense_admin',
      amountCents: 200000,
      effectiveFromMonth: '2026-07',
    })
  })

  it('rejects a blank name (AC-05)', () => {
    expect(parseFixedCostForm(form({ name: '', category: 'expense_admin', amount: '100' }))).toBe(
      'Nome é obrigatório',
    )
  })

  it('rejects zero/negative value at the boundary (AC-05)', () => {
    expect(
      parseFixedCostForm(form({ name: 'Aluguel', category: 'expense_admin', amount: '0' })),
    ).toBe('Valor deve ser maior que zero')
    expect(
      parseFixedCostForm(form({ name: 'Aluguel', category: 'expense_admin', amount: '-5' })),
    ).toBe('Valor deve ser maior que zero')
  })

  it('rejects an unknown category', () => {
    expect(parseFixedCostForm(form({ name: 'Aluguel', category: 'revenue', amount: '100' }))).toBe(
      'Categoria inválida',
    )
  })
})

describe('parseAmountToCents', () => {
  it('parses BR-formatted amounts to integer cents', () => {
    expect(parseAmountToCents('2.000,00')).toBe(200000)
    expect(parseAmountToCents('2000')).toBe(200000)
    expect(parseAmountToCents('2000,50')).toBe(200050)
    expect(parseAmountToCents('1.234,56')).toBe(123456)
  })

  it('returns null for non-numeric / empty', () => {
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
  })
})

describe('parseEffectiveFromMonth', () => {
  it('normalizes a YYYY-MM month to its competence-month label', () => {
    expect(parseEffectiveFromMonth('2026-03')).toBe('2026-03')
  })

  it('defaults empty to the current month', () => {
    const now = new Date('2026-07-15T10:00:00.000Z')
    expect(parseEffectiveFromMonth('', now)).toBe('2026-07')
  })

  it('buckets an ISO date into its competence month', () => {
    expect(parseEffectiveFromMonth('2026-11-23T14:00:00.000Z')).toBe('2026-11')
  })

  it('rejects an invalid month', () => {
    expect(parseEffectiveFromMonth('2026-13')).toBeNull()
    expect(parseEffectiveFromMonth('not-a-date')).toBeNull()
  })
})
