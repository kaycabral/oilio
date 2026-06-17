import { describe, expect, it } from 'vitest'
import type { SubscriptionPlan } from '../types/subscription-plan'
import { buildPlanSnapshot } from './plan-snapshot'

function makePlan(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: 'plan-1',
    tenantId: 't1',
    name: 'Mensal Corte',
    description: null,
    priceCents: 9000,
    billingCycle: 'monthly',
    includedItemIds: ['svc-corte'],
    includedCategoryIds: ['corte'],
    usageLimit: { kind: 'count', quantity: 4 },
    active: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildPlanSnapshot', () => {
  it('copies the core fields verbatim', () => {
    const snap = buildPlanSnapshot(makePlan())
    expect(snap).toMatchObject({
      planId: 'plan-1',
      name: 'Mensal Corte',
      priceCents: 9000,
      billingCycle: 'monthly',
      includedItemIds: ['svc-corte'],
      includedCategoryIds: ['corte'],
      usageLimit: { kind: 'count', quantity: 4 },
    })
  })

  it('uses the plan values when no overrides are passed', () => {
    const snap = buildPlanSnapshot(makePlan({ priceCents: 12345, billingCycle: 'annual' }))
    expect(snap.priceCents).toBe(12345)
    expect(snap.billingCycle).toBe('annual')
  })

  it('overrides price + cycle when provided (lawful-price reprice path)', () => {
    const snap = buildPlanSnapshot(makePlan({ priceCents: 9000, billingCycle: 'monthly' }), {
      priceCents: 7000,
      billingCycle: 'quarterly',
    })
    expect(snap.priceCents).toBe(7000)
    expect(snap.billingCycle).toBe('quarterly')
  })

  it('omits the optional scope axes when the plan is unrestricted', () => {
    const snap = buildPlanSnapshot(makePlan())
    expect('unitAllowlist' in snap).toBe(false)
    expect('allowedTimeScope' in snap).toBe(false)
    expect('bookingLimits' in snap).toBe(false)
  })

  it('freezes unitAllowlist as an independent copy', () => {
    const plan = makePlan({ unitAllowlist: ['u1', 'u2'] })
    const snap = buildPlanSnapshot(plan)
    expect(snap.unitAllowlist).toEqual(['u1', 'u2'])
    plan.unitAllowlist!.push('u3')
    expect(snap.unitAllowlist).toEqual(['u1', 'u2'])
  })

  it('freezes every allowedTimeScope sub-field present', () => {
    const plan = makePlan({
      allowedTimeScope: {
        daysOfWeek: [1, 2, 3],
        hourRange: { start: '09:00', end: '18:00' },
        advanceBookingDays: 7,
      },
    })
    const snap = buildPlanSnapshot(plan)
    expect(snap.allowedTimeScope).toEqual({
      daysOfWeek: [1, 2, 3],
      hourRange: { start: '09:00', end: '18:00' },
      advanceBookingDays: 7,
    })
    plan.allowedTimeScope!.daysOfWeek!.push(4)
    expect(snap.allowedTimeScope!.daysOfWeek).toEqual([1, 2, 3])
  })

  it('keeps allowedTimeScope sub-fields independently optional', () => {
    const snap = buildPlanSnapshot(makePlan({ allowedTimeScope: { daysOfWeek: [0] } }))
    expect(snap.allowedTimeScope).toEqual({ daysOfWeek: [0] })
    expect('hourRange' in snap.allowedTimeScope!).toBe(false)
    expect('advanceBookingDays' in snap.allowedTimeScope!).toBe(false)
  })

  it('handles advanceBookingDays = 0 (typeof number, not falsy-skipped)', () => {
    const snap = buildPlanSnapshot(makePlan({ allowedTimeScope: { advanceBookingDays: 0 } }))
    expect(snap.allowedTimeScope).toEqual({ advanceBookingDays: 0 })
  })

  it('freezes the bookingLimits axis with only the set sub-fields', () => {
    const snap = buildPlanSnapshot(
      makePlan({
        bookingLimits: { maxPerDay: 1, maxConcurrent: 2, requireCompleteBeforeNext: true },
      }),
    )
    expect(snap.bookingLimits).toEqual({
      maxPerDay: 1,
      maxConcurrent: 2,
      requireCompleteBeforeNext: true,
    })
  })

  it('handles maxPerDay = 0 and drops requireCompleteBeforeNext when not strictly true', () => {
    const snap = buildPlanSnapshot(
      makePlan({ bookingLimits: { maxPerDay: 0, requireCompleteBeforeNext: false } }),
    )
    expect(snap.bookingLimits).toEqual({ maxPerDay: 0 })
    expect('requireCompleteBeforeNext' in snap.bookingLimits!).toBe(false)
    expect('maxConcurrent' in snap.bookingLimits!).toBe(false)
  })
})
