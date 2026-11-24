import type { FixedCost, FixedCostOverride } from '@/domain'
import { classifyFixedCost } from '@/domain'
import { describe, expect, it } from 'vitest'

import { expandFixedCosts } from './expand-fixed-costs'

const UTC = () => 'UTC'

function cost(over: Partial<FixedCost> = {}): FixedCost {
  return {
    id: 'fc-1',
    orgId: 't1',
    unitId: 'unit1',
    seriesId: 'series-1',
    name: 'Aluguel',
    category: 'expense_admin',
    amountCents: 200000,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('expandFixedCosts', () => {
  it('expands one fact per competence month of the window (AC-06)', () => {
    const facts = expandFixedCosts({
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2026-04-01T00:00:00.000Z',
      costs: [cost()],
      overrides: [],
      timezoneForUnit: UTC,
    })
    expect(facts.map((f) => f.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(facts.every((f) => f.amountCents === 200000)).toBe(true)
    expect(facts[0]?.occurredAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('a single override replaces only its own month (AC-03)', () => {
    const override: FixedCostOverride = {
      id: 'o1',
      orgId: 't1',
      unitId: 'unit1',
      seriesId: 'series-1',
      month: '2026-02',
      amountCents: 250000,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    }
    const facts = expandFixedCosts({
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2026-04-01T00:00:00.000Z',
      costs: [cost()],
      overrides: [override],
      timezoneForUnit: UTC,
    })
    const byMonth = Object.fromEntries(facts.map((f) => [f.month, f.amountCents]))
    expect(byMonth).toEqual({ '2026-01': 200000, '2026-02': 250000, '2026-03': 200000 })
  })

  it('a closed vigência stops at its effectiveTo; a later slice takes over (AC-08)', () => {
    const jan = cost({
      id: 'fc-old',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-03-01T00:00:00.000Z',
      amountCents: 200000,
    })
    const mar = cost({
      id: 'fc-new',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      effectiveTo: null,
      amountCents: 230000,
    })
    const facts = expandFixedCosts({
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2026-05-01T00:00:00.000Z',
      costs: [jan, mar],
      overrides: [],
      timezoneForUnit: UTC,
    })
    const byMonth = Object.fromEntries(facts.map((f) => [f.month, f.amountCents]))
    expect(byMonth).toEqual({
      '2026-01': 200000,
      '2026-02': 200000,
      '2026-03': 230000,
      '2026-04': 230000,
    })
  })

  it('an archived cost is not passed in (it never expands)', () => {
    const facts = expandFixedCosts({
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2026-02-01T00:00:00.000Z',
      costs: [],
      overrides: [],
      timezoneForUnit: UTC,
    })
    expect(facts).toEqual([])
  })
})

describe('classifyFixedCost', () => {
  it('produces a deterministic id per (series, month) with direction out (AC-07)', () => {
    const [entry] = classifyFixedCost({
      orgId: 't1',
      unitId: 'unit1',
      seriesId: 'series-1',
      nature: 'expense_admin',
      amountCents: 200000,
      month: '2026-02',
      occurredAt: '2026-02-01T00:00:00.000Z',
    })
    expect(entry?.id).toBe('manual:series-1:2026-02')
    expect(entry?.direction).toBe('out')
    expect(entry?.behavior).toBe('fixed')
    expect(entry?.link).toBe('unit')
    expect(entry?.nature).toBe('expense_admin')
    expect(entry?.amountCents).toBe(200000)
    expect(entry?.occurredAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('two months of the same cost get distinct deterministic ids', () => {
    const jan = classifyFixedCost({
      orgId: 't1',
      unitId: 'unit1',
      seriesId: 's',
      nature: 'expense_admin',
      amountCents: 100,
      month: '2026-01',
      occurredAt: '2026-01-01T00:00:00.000Z',
    })
    const feb = classifyFixedCost({
      orgId: 't1',
      unitId: 'unit1',
      seriesId: 's',
      nature: 'expense_admin',
      amountCents: 100,
      month: '2026-02',
      occurredAt: '2026-02-01T00:00:00.000Z',
    })
    expect(jan[0]?.id).toBe('manual:s:2026-01')
    expect(feb[0]?.id).toBe('manual:s:2026-02')
  })

  it('drops a zero/negative amount', () => {
    expect(
      classifyFixedCost({
        orgId: 't1',
        unitId: 'unit1',
        seriesId: 's',
        nature: 'expense_admin',
        amountCents: 0,
        month: '2026-01',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual([])
  })
})
