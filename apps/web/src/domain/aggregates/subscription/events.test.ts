import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { SubscriptionEventSchema } from './events'

const decode = Schema.decodeUnknownSync(SubscriptionEventSchema)

const plan = {
  planId: 'p1',
  name: 'Mensal Corte',
  priceCents: 9000,
  billingCycle: 'monthly',
  includedItemIds: ['svc-corte'],
  includedCategoryIds: ['corte'],
  usageLimit: { kind: 'count', quantity: 4 },
  unitAllowlist: ['u1'],
  allowedTimeScope: {
    daysOfWeek: [1, 2, 3],
    hourRange: { start: '09:00', end: '18:00' },
    advanceBookingDays: 7,
  },
  bookingLimits: { maxPerDay: 1, maxConcurrent: 2, requireCompleteBeforeNext: true },
}

const created = {
  _tag: 'subscription.created',
  id: 's1',
  orgId: 't1',
  unitId: 'u1',
  customerId: 'c1',
  customerUserId: null,
  planId: 'p1',
  plan,
  periodStart: '2026-01-01',
  periodEnd: '2026-02-01',
  nextChargeDate: '2026-02-01',
  pastDueThreshold: 3,
}

const SAMPLES: Record<string, unknown> = {
  'subscription.created': created,
  'subscription.charge_settled': { _tag: 'subscription.charge_settled' },
  'subscription.charge_failed': {
    _tag: 'subscription.charge_failed',
    reason: 'insufficient_funds',
    status: 'past_due',
  },
  'subscription.cancelled_for_non_payment': {
    _tag: 'subscription.cancelled_for_non_payment',
    failedChargeCount: 3,
  },
  'subscription.cancelled': { _tag: 'subscription.cancelled', cancelledBy: 'owner-1' },
  'subscription.cancel_scheduled': {
    _tag: 'subscription.cancel_scheduled',
    cancelledBy: 'owner-1',
    cancellationReason: null,
  },
  'subscription.reactivated': { _tag: 'subscription.reactivated' },
  'subscription.renewed': {
    _tag: 'subscription.renewed',
    periodStart: '2026-02-01',
    periodEnd: '2026-03-01',
    nextChargeDate: null,
  },
  'subscription.plan_changed': {
    _tag: 'subscription.plan_changed',
    planId: 'p2',
    plan,
    changedBy: 'owner-1',
  },
  'subscription.usage_incremented': { _tag: 'subscription.usage_incremented', amount: 1 },
  'subscription.deleted': { _tag: 'subscription.deleted', deletedBy: 'owner-1' },
}

describe('SubscriptionEventSchema', () => {
  for (const [tag, sample] of Object.entries(SAMPLES)) {
    it(`decodes a valid ${tag} event`, () => {
      const decoded = decode(sample) as { _tag: string }
      expect(decoded._tag).toBe(tag)
    })
  }

  it('rejects an unknown _tag', () => {
    expect(() => decode({ _tag: 'subscription.unknown' })).toThrow()
  })

  it('rejects a created event missing a required field', () => {
    const { orgId: _omitted, ...withoutOrg } = created
    expect(() => decode(withoutOrg)).toThrow()
  })

  it('rejects an invalid charge_failed status literal', () => {
    expect(() =>
      decode({ _tag: 'subscription.charge_failed', reason: 'x', status: 'frozen' }),
    ).toThrow()
  })
})

describe('PlanSnapshotSchema (via created)', () => {
  it('rejects an unknown billingCycle literal', () => {
    const bad = {
      ...created,
      plan: { ...plan, billingCycle: 'weekly' },
    }
    expect(() => decode(bad)).toThrow()
  })

  it('rejects an invalid usageLimit kind', () => {
    const bad = {
      ...created,
      plan: { ...plan, usageLimit: { kind: 'infinite' } },
    }
    expect(() => decode(bad)).toThrow()
  })

  it('accepts the unlimited usageLimit variant', () => {
    const ok = {
      ...created,
      plan: { ...plan, usageLimit: { kind: 'unlimited' } },
    }
    expect(() => decode(ok)).not.toThrow()
  })

  it('accepts a created event with the optional plan axes omitted', () => {
    const minimalPlan = {
      planId: 'p1',
      name: 'Mensal',
      priceCents: 9000,
      billingCycle: 'annual',
      includedItemIds: [],
      includedCategoryIds: [],
      usageLimit: { kind: 'unlimited' },
    }
    const ok = {
      ...created,
      plan: minimalPlan,
    }
    expect(() => decode(ok)).not.toThrow()
  })
})
