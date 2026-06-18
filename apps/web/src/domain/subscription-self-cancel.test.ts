// Unit tests pra canCustomerCancelSubscription — AC-11/12 brief 0003 (#651).

import { describe, expect, it } from 'vitest'
import { canCustomerCancelSubscription } from './subscription-self-cancel'
import type { Subscription } from './types/subscription'

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    orgId: 'org-1',
    unitId: 'unit-a',
    customerId: 'cust-1',
    customerUserId: 'user-1',
    plan: {
      planId: 'plan-1',
      name: 'Mensal',
      priceCents: 9000,
      billingCycle: 'monthly',
      includedItemIds: [],
      includedCategoryIds: [],
      usageLimit: { kind: 'unlimited' },
    },
    status: 'active',
    currentPeriod: { startAt: '2026-05-01', endAt: '2026-06-01', consumed: 0 },
    cancelAtPeriodEnd: false,
    nextChargeDate: '2026-06-01',
    pastDueCycles: 0,
    pastDueThreshold: 2,
    cancellationReason: null,
    cancelledAt: null,
    createdAt: '2026-05-01',
    updatedAt: '2026-05-01',
    ...overrides,
  }
}

describe('canCustomerCancelSubscription', () => {
  it('aceita owner com subscription ativa', () => {
    const result = canCustomerCancelSubscription(makeSubscription(), 'user-1')
    expect(result).toEqual({ canCancel: true })
  })

  it('aceita status past_due (owner ainda pode cancelar)', () => {
    const result = canCustomerCancelSubscription(
      makeSubscription({ status: 'past_due', pastDueCycles: 1 }),
      'user-1',
    )
    expect(result).toEqual({ canCancel: true })
  })

  it('rejeita uid diferente (wrong_owner)', () => {
    const result = canCustomerCancelSubscription(makeSubscription(), 'someone-else')
    expect(result).toEqual({ canCancel: false, reason: 'wrong_owner' })
  })

  it('rejeita status cancelled (already_cancelled)', () => {
    const result = canCustomerCancelSubscription(
      makeSubscription({ status: 'cancelled' }),
      'user-1',
    )
    expect(result).toEqual({ canCancel: false, reason: 'already_cancelled' })
  })

  it('rejeita status cancelled_for_non_payment (already_cancelled)', () => {
    const result = canCustomerCancelSubscription(
      makeSubscription({ status: 'cancelled_for_non_payment' }),
      'user-1',
    )
    expect(result).toEqual({ canCancel: false, reason: 'already_cancelled' })
  })

  it('rejeita cancelAtPeriodEnd já marcado', () => {
    const result = canCustomerCancelSubscription(
      makeSubscription({ cancelAtPeriodEnd: true }),
      'user-1',
    )
    expect(result).toEqual({
      canCancel: false,
      reason: 'cancel_at_period_end_already_set',
    })
  })

  it('rejeita customerUserId null em legacy data', () => {
    const result = canCustomerCancelSubscription(
      makeSubscription({ customerUserId: null }),
      'user-1',
    )
    expect(result).toEqual({ canCancel: false, reason: 'wrong_owner' })
  })
})
