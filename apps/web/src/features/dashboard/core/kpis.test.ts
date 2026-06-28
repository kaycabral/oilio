import type { Appointment, Order, Subscription } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  computeOccupancyPct,
  isActiveSubscription,
  subscriptionMrrCents,
  sumOrderTotals,
} from './kpis'

function makeSub(
  partial: Partial<Subscription> & {
    priceCents: number
    billingCycle: Subscription['plan']['billingCycle']
    status?: Subscription['status']
  },
): Subscription {
  const base: Subscription = {
    id: 's',
    orgId: 't',
    unitId: 'u',
    customerId: 'c',
    customerUserId: null,
    plan: {
      planId: 'p',
      name: 'Plan',
      priceCents: partial.priceCents,
      billingCycle: partial.billingCycle,
      includedItemIds: [],
      includedCategoryIds: [],
      usageLimit: { kind: 'unlimited' },
    },
    status: partial.status ?? 'active',
    currentPeriod: { startAt: '', endAt: '', consumed: 0 },
    cancelAtPeriodEnd: false,
    nextChargeDate: null,
    pastDueCycles: 0,
    pastDueThreshold: 2,
    cancellationReason: null,
    cancelledAt: null,
    createdAt: '',
    updatedAt: '',
  }
  return { ...base, ...partial }
}

describe('subscriptionMrrCents', () => {
  it('returns priceCents for monthly cycle', () => {
    expect(subscriptionMrrCents(makeSub({ priceCents: 9990, billingCycle: 'monthly' }))).toBe(9990)
  })
  it('divides quarterly by 3', () => {
    expect(subscriptionMrrCents(makeSub({ priceCents: 30000, billingCycle: 'quarterly' }))).toBe(
      10000,
    )
  })
  it('divides semiannual by 6', () => {
    expect(subscriptionMrrCents(makeSub({ priceCents: 60000, billingCycle: 'semiannual' }))).toBe(
      10000,
    )
  })
  it('divides annual by 12', () => {
    expect(subscriptionMrrCents(makeSub({ priceCents: 120000, billingCycle: 'annual' }))).toBe(
      10000,
    )
  })
})

describe('isActiveSubscription', () => {
  it('counts active and recovering as active', () => {
    expect(
      isActiveSubscription(makeSub({ priceCents: 0, billingCycle: 'monthly', status: 'active' })),
    ).toBe(true)
    expect(
      isActiveSubscription(makeSub({ priceCents: 0, billingCycle: 'monthly', status: 'past_due' })),
    ).toBe(true)
  })
  it('excludes pending, suspended, cancelled', () => {
    expect(
      isActiveSubscription(makeSub({ priceCents: 0, billingCycle: 'monthly', status: 'pending' })),
    ).toBe(false)
    expect(
      isActiveSubscription(
        makeSub({ priceCents: 0, billingCycle: 'monthly', status: 'suspended' }),
      ),
    ).toBe(false)
    expect(
      isActiveSubscription(
        makeSub({ priceCents: 0, billingCycle: 'monthly', status: 'cancelled' }),
      ),
    ).toBe(false)
  })
})

function makeOrder(totalCents: number): Order {
  return {
    id: 'o',
    orgId: 't',
    unitId: 'u',
    customerId: null,
    appointmentId: null,
    status: 'closed',
    items: [],
    discountCents: 0,
    closedAt: '2026-01-01T00:00:00.000Z',
    paymentMethod: null,
    subtotalCents: totalCents,
    totalCents,
    createdAt: '',
    updatedAt: '',
  }
}

describe('sumOrderTotals', () => {
  it('sums totalCents across orders', () => {
    const orders = [makeOrder(100), makeOrder(250), makeOrder(0)]
    expect(sumOrderTotals(orders)).toBe(350)
  })
  it('handles empty list', () => {
    expect(sumOrderTotals([])).toBe(0)
  })
})

describe('computeOccupancyPct', () => {
  function appt(status: Appointment['status']): Appointment {
    return {
      id: 'a',
      orgId: 't',
      unitId: 'u',
      memberOperationId: 'p',
      customerId: 'c',
      serviceId: 's',
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-01T00:30:00.000Z',
      status,
      servicePriceCentsSnapshot: 5000,
      serviceDurationMinutesSnapshot: 30,
      commissionSnapshot: null,
      cancellationPolicySnapshot: null,
      customerUserId: 'cu',
      memberOperatorUserId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }

  it('returns 0 for empty list', () => {
    expect(computeOccupancyPct([])).toBe(0)
  })

  it('ignores scheduled (future) appointments when computing the rate', () => {
    // 2 completed + 1 scheduled → 100% (scheduled excluded from denominator)
    expect(computeOccupancyPct([appt('completed'), appt('completed'), appt('scheduled')])).toBe(100)
  })

  it('counts cancelled and no_show in the denominator', () => {
    // 1 completed, 1 cancelled, 1 no_show → 33.3%
    expect(computeOccupancyPct([appt('completed'), appt('cancelled'), appt('no_show')])).toBe(33.3)
  })

  it('returns 0 when all appointments are still scheduled', () => {
    expect(computeOccupancyPct([appt('scheduled'), appt('scheduled')])).toBe(0)
  })
})
