import type { SubscriptionPlan } from '@/domain'
import { describe, expect, it } from 'vitest'
import { derivePlanFormDefaults } from './plan-form-defaults'

function plan(over: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: 'plan-1',
    orgId: 't1',
    name: 'Plano Mensal',
    description: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: [],
    includedCategoryIds: [],
    usageLimit: { kind: 'unlimited' },
    active: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('derivePlanFormDefaults', () => {
  it('defaults a brand-new plan (no plan passed) to empty/count', () => {
    const d = derivePlanFormDefaults(undefined)
    expect(d.limitKind).toBe('count')
    expect(d.initialPrice).toBe('')
    expect(d.initialQuantity).toBe('')
    expect(d.restrictUnits).toBe(false)
    expect(d.restrictDays).toBe(false)
    expect(d.restrictHours).toBe(false)
    expect(d.restrictAdvance).toBe(false)
    expect(d.restrictBookingLimits).toBe(false)
    expect(d.initialAllowlist.size).toBe(0)
    expect(d.initialDays.size).toBe(0)
  })

  it('formats price (pt-BR comma) and surfaces a count quantity', () => {
    const d = derivePlanFormDefaults(
      plan({ priceCents: 12345, usageLimit: { kind: 'count', quantity: 8 } }),
    )
    expect(d.initialPrice).toBe('123,45')
    expect(d.limitKind).toBe('count')
    expect(d.initialQuantity).toBe('8')
  })

  it('leaves quantity empty for an unlimited plan', () => {
    const d = derivePlanFormDefaults(plan({ usageLimit: { kind: 'unlimited' } }))
    expect(d.limitKind).toBe('unlimited')
    expect(d.initialQuantity).toBe('')
  })

  it('flags restrictUnits + seeds the allowlist when a non-empty allowlist exists', () => {
    const d = derivePlanFormDefaults(plan({ unitAllowlist: ['u1', 'u2'] }))
    expect(d.restrictUnits).toBe(true)
    expect([...d.initialAllowlist]).toEqual(['u1', 'u2'])
  })

  it('does not flag restrictUnits for an empty allowlist', () => {
    expect(derivePlanFormDefaults(plan({ unitAllowlist: [] })).restrictUnits).toBe(false)
  })

  it('derives each time-scope axis independently', () => {
    expect(
      derivePlanFormDefaults(plan({ allowedTimeScope: { daysOfWeek: [1, 3] } })).restrictDays,
    ).toBe(true)
    expect([
      ...derivePlanFormDefaults(plan({ allowedTimeScope: { daysOfWeek: [1, 3] } })).initialDays,
    ]).toEqual([1, 3])
    expect(
      derivePlanFormDefaults(
        plan({ allowedTimeScope: { hourRange: { start: '08:00', end: '12:00' } } }),
      ).restrictHours,
    ).toBe(true)
    expect(
      derivePlanFormDefaults(plan({ allowedTimeScope: { advanceBookingDays: 30 } }))
        .restrictAdvance,
    ).toBe(true)
    expect(
      derivePlanFormDefaults(plan({ allowedTimeScope: { advanceBookingDays: 0 } })).restrictAdvance,
    ).toBe(false)
  })

  it('flags restrictBookingLimits when any booking-limit sub-field is set', () => {
    expect(
      derivePlanFormDefaults(plan({ bookingLimits: { maxPerDay: 2 } })).restrictBookingLimits,
    ).toBe(true)
    expect(
      derivePlanFormDefaults(plan({ bookingLimits: { maxConcurrent: 1 } })).restrictBookingLimits,
    ).toBe(true)
    expect(
      derivePlanFormDefaults(plan({ bookingLimits: { requireCompleteBeforeNext: true } }))
        .restrictBookingLimits,
    ).toBe(true)
    expect(derivePlanFormDefaults(plan({ bookingLimits: {} })).restrictBookingLimits).toBe(false)
  })

  it('seeds included item + category sets', () => {
    const d = derivePlanFormDefaults(
      plan({ includedItemIds: ['i1'], includedCategoryIds: ['c1', 'c2'] }),
    )
    expect([...d.initialItemIds]).toEqual(['i1'])
    expect([...d.initialCategoryIds]).toEqual(['c1', 'c2'])
  })
})
