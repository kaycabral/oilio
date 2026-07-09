import { describe, expect, it } from 'vitest'

import type { EventMeta } from '@/domain/effect/event-store'
import type { SubscriptionPlanSnapshot } from '@/domain/types/subscription'
import { applySubscriptionEvent } from './reducer'
import { INITIAL_SUBSCRIPTION_STATE, type SubscriptionState } from './types'

const PLAN: SubscriptionPlanSnapshot = {
  planId: 'p1',
  name: 'Mensal Corte',
  priceCents: 9000,
  billingCycle: 'monthly',
  includedItemIds: ['svc-corte'],
  includedCategoryIds: ['corte'],
  usageLimit: { kind: 'count', quantity: 4 },
}

function meta(version: number, timestamp = '2026-06-01T10:00:00.000Z'): EventMeta {
  return { version, timestamp, actorId: 'user-1', schemaVersion: 1 }
}

function created(): SubscriptionState {
  return applySubscriptionEvent(
    INITIAL_SUBSCRIPTION_STATE,
    {
      _tag: 'subscription.created',
      id: 's1',
      orgId: 't1',
      unitId: 'unit-a',
      customerId: 'c1',
      customerUserId: 'u-c1',
      planId: 'p1',
      plan: PLAN,
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-07-01T00:00:00.000Z',
      nextChargeDate: '2026-07-01T00:00:00.000Z',
      pastDueThreshold: 2,
    },
    meta(1),
  )
}

describe('Subscription reducer', () => {
  it('created → pending com snapshot completo (id, plano, período, atores)', () => {
    const s = created()
    expect(s.status).toBe('pending')
    expect(s.id).toBe('s1')
    expect(s.unitId).toBe('unit-a')
    expect(s.customerId).toBe('c1')
    expect(s.customerUserId).toBe('u-c1')
    expect(s.plan).toEqual(PLAN)
    expect(s.currentPeriod).toEqual({
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-07-01T00:00:00.000Z',
      consumed: 0,
    })
    expect(s.pastDueThreshold).toBe(2)
    expect(s.cancelAtPeriodEnd).toBe(false)
    expect(s.createdAt).toBe('2026-06-01T10:00:00.000Z')
    expect(s.updatedAt).toBe('2026-06-01T10:00:00.000Z')
    expect(s._version).toBe(1)
  })

  it('charge_settled → active preservando período e consumo', () => {
    const pastDue: SubscriptionState = {
      ...created(),
      status: 'past_due',
      currentPeriod: {
        startAt: '2026-06-01T00:00:00.000Z',
        endAt: '2026-07-01T00:00:00.000Z',
        consumed: 3,
      },
      _version: 2,
    }
    const s = applySubscriptionEvent(pastDue, { _tag: 'subscription.charge_settled' }, meta(3))
    expect(s.status).toBe('active')
    expect(s.currentPeriod.consumed).toBe(3)
  })

  it('charge_settled não reativa assinatura cancelled', () => {
    const cancelled: SubscriptionState = { ...created(), status: 'cancelled' }
    const s = applySubscriptionEvent(cancelled, { _tag: 'subscription.charge_settled' }, meta(2))
    expect(s.status).toBe('cancelled')
  })

  it('charge_failed usa o status decidido pela action (default past_due)', () => {
    const s1 = applySubscriptionEvent(
      created(),
      { _tag: 'subscription.charge_failed', reason: 'card_declined' },
      meta(2),
    )
    expect(s1.status).toBe('past_due')
    const s2 = applySubscriptionEvent(
      created(),
      { _tag: 'subscription.charge_failed', reason: 'x', status: 'suspended' },
      meta(2),
    )
    expect(s2.status).toBe('suspended')
  })

  it('cancel_scheduled marca cancelAtPeriodEnd sem cortar status', () => {
    const active: SubscriptionState = { ...created(), status: 'active' }
    const s = applySubscriptionEvent(
      active,
      {
        _tag: 'subscription.cancel_scheduled',
        cancelledBy: 'user-1',
        cancellationReason: 'mudou de cidade',
      },
      meta(2),
    )
    expect(s.status).toBe('active')
    expect(s.cancelAtPeriodEnd).toBe(true)
    expect(s.cancellationReason).toBe('mudou de cidade')
  })

  it('reactivated desfaz o cancelamento agendado', () => {
    const scheduled: SubscriptionState = {
      ...created(),
      cancelAtPeriodEnd: true,
      cancellationReason: 'arrependeu',
    }
    const s = applySubscriptionEvent(scheduled, { _tag: 'subscription.reactivated' }, meta(2))
    expect(s.cancelAtPeriodEnd).toBe(false)
    expect(s.cancellationReason).toBeNull()
  })

  it('cancelled → corte imediato com cancelledAt do meta', () => {
    const scheduled: SubscriptionState = {
      ...created(),
      cancelAtPeriodEnd: true,
      nextChargeDate: '2026-07-01T00:00:00.000Z',
    }
    const s = applySubscriptionEvent(
      scheduled,
      { _tag: 'subscription.cancelled', cancelledBy: 'user-1' },
      meta(2, '2026-06-15T12:00:00.000Z'),
    )
    expect(s.status).toBe('cancelled')
    expect(s.cancelledAt).toBe('2026-06-15T12:00:00.000Z')
    expect(s.cancelAtPeriodEnd).toBe(false)
    expect(s.nextChargeDate).toBeNull()
  })

  it('renewed abre novo período e zera consumo', () => {
    const used = created()
    const s = applySubscriptionEvent(
      { ...used, currentPeriod: { ...used.currentPeriod, consumed: 4 } },
      {
        _tag: 'subscription.renewed',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
        nextChargeDate: '2026-08-01T00:00:00.000Z',
      },
      meta(2),
    )
    expect(s.currentPeriod).toEqual({
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-08-01T00:00:00.000Z',
      consumed: 0,
    })
  })

  it('plan_changed troca o snapshot congelado (preço/coverage/limite) do change-point', () => {
    const PLAN_B: SubscriptionPlanSnapshot = {
      planId: 'p2',
      name: 'Mensal Premium',
      priceCents: 15000,
      billingCycle: 'monthly',
      includedItemIds: ['svc-corte', 'svc-barba'],
      includedCategoryIds: ['corte', 'barba'],
      usageLimit: { kind: 'unlimited' },
    }
    const active: SubscriptionState = { ...created(), status: 'active' }
    const s = applySubscriptionEvent(
      active,
      { _tag: 'subscription.plan_changed', planId: 'p2', plan: PLAN_B, changedBy: 'user-1' },
      meta(2),
    )
    expect(s.plan).toEqual(PLAN_B)
    expect(s.status).toBe('active')
    expect(s.currentPeriod).toEqual(active.currentPeriod)
    const renewed = applySubscriptionEvent(
      s,
      {
        _tag: 'subscription.renewed',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
        nextChargeDate: '2026-08-01T00:00:00.000Z',
      },
      meta(3),
    )
    expect(renewed.plan).toEqual(PLAN_B)
  })

  it('usage_incremented soma em currentPeriod.consumed', () => {
    const s = applySubscriptionEvent(
      created(),
      { _tag: 'subscription.usage_incremented', amount: 2 },
      meta(2),
    )
    expect(s.currentPeriod.consumed).toBe(2)
  })
})
