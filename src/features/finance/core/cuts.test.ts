import { type LedgerEntry, Money } from '@/domain'
import { describe, expect, it } from 'vitest'

import { breakEven, fixedCostCents, partialContributionMargin } from './cuts'

function entry(
  over: Partial<Omit<LedgerEntry, 'amountCents'>> &
    Pick<LedgerEntry, 'nature' | 'direction'> & { amountCents: number },
): LedgerEntry {
  return {
    id: `${over.source ?? 'order'}:x`,
    orgId: 't1',
    unitId: 'unit1',
    behavior: 'variable',
    link: 'item',
    source: 'order',
    sourceId: 'x',
    itemId: null,
    occurredAt: '2026-07-01T13:00:00.000Z',
    ...over,
    amountCents: Money(over.amountCents),
  }
}

describe('partialContributionMargin', () => {
  it('derives revenue − commission from ledger entries alone', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 10000, source: 'order' }),
      entry({ nature: 'revenue', direction: 'in', amountCents: 8000, source: 'charge' }),
      entry({ nature: 'csp', direction: 'out', amountCents: 4000, source: 'commission' }),
    ]
    const mc = partialContributionMargin(ledger)
    expect(mc).toEqual({
      revenueCents: 18000,
      variableCostCents: 4000,
      marginCents: 14000,
      partial: true,
    })
  })

  it('a sale reversal (revenue + out) subtracts from revenue', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 10000 }),
      entry({ nature: 'revenue', direction: 'out', amountCents: 3000, source: 'cash_movement' }),
    ]
    const mc = partialContributionMargin(ledger)
    expect(mc.revenueCents).toBe(7000)
    expect(mc.marginCents).toBe(7000)
  })

  it('marks partial=false once a non-commission variable (tax/MDR/CMV) is present', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 10000 }),
      entry({ nature: 'csp', direction: 'out', amountCents: 2000 }),
      entry({ nature: 'tax_on_sale', direction: 'out', amountCents: 600 }),
    ]
    const mc = partialContributionMargin(ledger)
    expect(mc.variableCostCents).toBe(2600)
    expect(mc.partial).toBe(false)
  })

  it('ignores fixed-behavior entries (they are below the contribution margin)', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 10000 }),
      entry({ nature: 'expense_admin', direction: 'out', amountCents: 5000, behavior: 'fixed' }),
    ]
    const mc = partialContributionMargin(ledger)
    expect(mc.variableCostCents).toBe(0)
    expect(mc.marginCents).toBe(10000)
  })

  it('degenerate: empty ledger yields zeroed margin, partial=true', () => {
    expect(partialContributionMargin([])).toEqual({
      revenueCents: 0,
      variableCostCents: 0,
      marginCents: 0,
      partial: true,
    })
  })
})

describe('fixedCostCents', () => {
  it('sums only fixed-behavior out entries', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 10000 }),
      entry({
        nature: 'expense_admin',
        direction: 'out',
        amountCents: 5000,
        behavior: 'fixed',
        source: 'manual',
      }),
      entry({
        nature: 'expense_commercial',
        direction: 'out',
        amountCents: 3000,
        behavior: 'fixed',
        source: 'manual',
      }),
      entry({ nature: 'csp', direction: 'out', amountCents: 2000 }),
    ]
    expect(fixedCostCents(ledger)).toBe(8000)
  })
})

describe('breakEven', () => {
  it('breakEven = fixed ÷ MC% when MC% > 0 (AC-09)', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 10000 }),
      entry({ nature: 'csp', direction: 'out', amountCents: 4000 }),
      entry({
        nature: 'expense_admin',
        direction: 'out',
        amountCents: 2000,
        behavior: 'fixed',
        source: 'manual',
      }),
    ]
    const be = breakEven(ledger)
    expect(be.computable).toBe(true)
    if (be.computable) {
      expect(be.fixedCostCents).toBe(2000)
      expect(be.marginRatio).toBeCloseTo(0.6, 5)
      expect(be.breakEvenRevenueCents).toBe(3333)
    }
  })

  it('the DoD example — fixed R$2.000, MC% 60% → sell R$3.334 (AC-09)', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 100000 }),
      entry({ nature: 'csp', direction: 'out', amountCents: 40000 }),
      entry({
        nature: 'expense_admin',
        direction: 'out',
        amountCents: 200000,
        behavior: 'fixed',
        source: 'manual',
      }),
    ]
    const be = breakEven(ledger)
    expect(be.computable).toBe(true)
    if (be.computable) expect(be.breakEvenRevenueCents).toBe(333333)
  })

  it('MC% ≤ 0 (variables ≥ revenue) is not computable — honest state (AC-10)', () => {
    const ledger = [
      entry({ nature: 'revenue', direction: 'in', amountCents: 5000 }),
      entry({ nature: 'csp', direction: 'out', amountCents: 6000 }),
      entry({
        nature: 'expense_admin',
        direction: 'out',
        amountCents: 2000,
        behavior: 'fixed',
        source: 'manual',
      }),
    ]
    const be = breakEven(ledger)
    expect(be.computable).toBe(false)
    if (!be.computable) {
      expect(be.reason).toBe('no_margin')
      expect(be.fixedCostCents).toBe(2000)
    }
  })

  it('degenerate: no sales (revenue = 0) is not computable, not ∞ (AC-10)', () => {
    const ledger = [
      entry({
        nature: 'expense_admin',
        direction: 'out',
        amountCents: 2000,
        behavior: 'fixed',
        source: 'manual',
      }),
    ]
    const be = breakEven(ledger)
    expect(be.computable).toBe(false)
  })
})
