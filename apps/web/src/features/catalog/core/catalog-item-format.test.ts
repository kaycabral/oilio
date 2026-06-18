import type { CatalogItemUnitOverride, Unit } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  commissionKindFor,
  formatCents,
  formatCommissionInput,
  overrideCommissionKindFor,
  resolveDefaultNewUnitIds,
} from './catalog-item-format'

function unit(over: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    orgId: 't1',
    name: 'Centro',
    slug: 'centro',
    whatsapp: '5511999990000',
    email: null,
    address: null,
    businessHours: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('formatCents', () => {
  it('formats cents as pt-BR decimal with a comma', () => {
    expect(formatCents(123456)).toBe('1234,56')
    expect(formatCents(8000)).toBe('80,00')
    expect(formatCents(0)).toBe('0,00')
  })

  it('returns empty for undefined (blank inherits the default)', () => {
    expect(formatCents(undefined)).toBe('')
  })
})

describe('formatCommissionInput', () => {
  it('shows fixed commission in reais (cents/100)', () => {
    expect(formatCommissionInput({ kind: 'fixed', value: 1500 })).toBe('15,00')
  })

  it('shows percentage commission as the raw percent', () => {
    expect(formatCommissionInput({ kind: 'percentage', value: 10 })).toBe('10')
  })

  it('returns empty for null/undefined', () => {
    expect(formatCommissionInput(null)).toBe('')
    expect(formatCommissionInput(undefined)).toBe('')
  })
})

describe('commissionKindFor', () => {
  it('maps a rule to its kind, null/undefined to "none"', () => {
    expect(commissionKindFor({ kind: 'percentage', value: 10 })).toBe('percentage')
    expect(commissionKindFor({ kind: 'fixed', value: 1500 })).toBe('fixed')
    expect(commissionKindFor(null)).toBe('none')
    expect(commissionKindFor(undefined)).toBe('none')
  })
})

describe('overrideCommissionKindFor', () => {
  it('returns "inherit" when commission is unset (undefined)', () => {
    const override: CatalogItemUnitOverride = {}
    expect(overrideCommissionKindFor(override)).toBe('inherit')
  })

  it('returns "none" when commission is explicitly null', () => {
    expect(overrideCommissionKindFor({ commission: null })).toBe('none')
  })

  it('returns the override commission kind otherwise', () => {
    expect(overrideCommissionKindFor({ commission: { kind: 'fixed', value: 500 } })).toBe('fixed')
    expect(overrideCommissionKindFor({ commission: { kind: 'percentage', value: 5 } })).toBe(
      'percentage',
    )
  })
})

describe('resolveDefaultNewUnitIds', () => {
  it('pre-checks the active unit when set', () => {
    expect(resolveDefaultNewUnitIds('u2', [unit({ id: 'u1' }), unit({ id: 'u2' })])).toEqual(['u2'])
  })

  it('pre-checks the sole unit when the org has exactly one', () => {
    expect(resolveDefaultNewUnitIds(null, [unit({ id: 'only' })])).toEqual(['only'])
  })

  it('returns empty when neither resolves (no active unit, multiple units)', () => {
    expect(resolveDefaultNewUnitIds(null, [unit({ id: 'u1' }), unit({ id: 'u2' })])).toEqual([])
  })
})
