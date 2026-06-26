import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import type { PersistencePort } from '../effect/services'
import { buildReactor, type EventReaction } from './_shared/reactions'
import { OrderConfig } from './order/config'
import { SubscriptionConfig } from './subscription/config'

const SUB_REF = aggregateRef(SubscriptionConfig, 't1', 's1')
const ORDER_REF = aggregateRef(OrderConfig, 't1', 'o1')

// Snapshot completo de criação — o evento `created` é a fonte única do estado.
const CREATED_PAYLOAD = {
  id: 's1',
  orgId: 't1',
  unitId: 'u1',
  customerId: 'c1',
  customerUserId: 'u-c1',
  planId: 'p1',
  plan: {
    planId: 'p1',
    name: 'Mensal',
    priceCents: 9000,
    billingCycle: 'monthly' as const,
    includedItemIds: ['svc-corte'],
    includedCategoryIds: ['corte'],
    usageLimit: { kind: 'count' as const, quantity: 4 },
  },
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  nextChargeDate: '2026-07-01T00:00:00.000Z',
  pastDueThreshold: 2,
}

describe('Feature 0020 — Definition of Done', () => {
  it('Scenario 1: Subscription lifecycle completo via eventos', async () => {
    const { store, events: eventLog, layer } = makeReplayStore()

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.created',
          actorId: 'owner-1',
          payload: CREATED_PAYLOAD,
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.charge_settled',
          actorId: 'system',
          payload: {},
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.charge_failed',
          actorId: 'gateway',
          payload: { reason: 'card_declined', status: 'past_due' },
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.charge_failed',
          actorId: 'gateway',
          payload: { reason: 'card_declined', status: 'past_due' },
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.cancelled_for_non_payment',
          actorId: 'system',
          payload: { failedChargeCount: 2 },
        })
      }).pipe(Effect.provide(layer)),
    )

    const events = (eventLog.get(docKey(SUB_REF)) ?? [])
      .slice()
      .sort(
        (a, b) =>
          (typeof a['version'] === 'number' ? a['version'] : 0) -
          (typeof b['version'] === 'number' ? b['version'] : 0),
      )

    expect(events).toHaveLength(5)
    expect(events[0]!['_tag']).toBe('subscription.created')
    expect(events[4]!['_tag']).toBe('subscription.cancelled_for_non_payment')

    for (let i = 0; i < events.length; i++) {
      expect(events[i]!['version']).toBe(i + 1)
    }

    const projection = store.get(docKey(SUB_REF))!
    expect(projection['status']).toBe('cancelled_for_non_payment')
    expect(projection['_version']).toBe(5)
  })

  it('Scenario 2: Order close com cascatas via eventos', async () => {
    const { store, layer } = makeReplayStore()

    const orderClosedReaction: EventReaction<PersistencePort, never> = {
      trigger: 'order.closed',
      handle: (env) =>
        Effect.gen(function* () {
          yield* appendEvent(SubscriptionConfig, SUB_REF, {
            _tag: 'subscription.usage_incremented',
            actorId: env.actorId,
            payload: { amount: 1 },
          }).pipe(Effect.catchTag('EventValidationError', () => Effect.void))
        }),
    }
    const reactor = buildReactor([orderClosedReaction])

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.created',
          actorId: 'owner',
          payload: CREATED_PAYLOAD,
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.charge_settled',
          actorId: 'system',
          payload: {},
        })

        yield* appendEvent(OrderConfig, ORDER_REF, {
          _tag: 'order.created',
          actorId: 'staff-1',
          payload: {
            data: {
              id: 'o1',
              orgId: 't1',
              unitId: 'u1',
              customerId: 'c1',
              appointmentId: 'a1',
              status: 'open',
              items: [],
              discountCents: 0,
              notes: null,
              closedAt: null,
              paymentMethod: null,
              subtotalCents: 0,
              totalCents: 0,
              createdAt: '2026-06-01T10:00:00Z',
              updatedAt: '2026-06-01T10:00:00Z',
            },
          },
        })
        yield* appendEvent(OrderConfig, ORDER_REF, {
          _tag: 'order.item_added',
          actorId: 'staff-1',
          payload: { changes: { subtotalCents: 5000, totalCents: 5000 } },
        })
        yield* appendEvent(OrderConfig, ORDER_REF, {
          _tag: 'order.item_added',
          actorId: 'staff-1',
          payload: { changes: { subtotalCents: 8000, totalCents: 8000 } },
        })
        const closeEnvelope = yield* appendEvent(OrderConfig, ORDER_REF, {
          _tag: 'order.closed',
          actorId: 'staff-1',
          payload: {
            closedAt: '2026-06-01T12:00:00Z',
            subtotalCents: 8000,
            totalCents: 8000,
            paymentMethod: 'pix',
          },
        })

        yield* reactor(closeEnvelope)
      }).pipe(Effect.provide(layer)),
    )

    const orderProjection = store.get(docKey(ORDER_REF))!
    expect(orderProjection['status']).toBe('closed')
    expect(orderProjection['totalCents']).toBe(8000)

    const subProjection = store.get(docKey(SUB_REF))!
    const currentPeriod = subProjection['currentPeriod']
    const consumed =
      typeof currentPeriod === 'object' && currentPeriod !== null && 'consumed' in currentPeriod
        ? currentPeriod.consumed
        : undefined
    expect(consumed).toBe(1)
  })

  it('Scenario 3: Replay reconstrói o estado COMPLETO idêntico à projeção', async () => {
    const { store, layer } = makeReplayStore()

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.created',
          actorId: 'owner',
          payload: CREATED_PAYLOAD,
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.charge_settled',
          actorId: 'system',
          payload: {},
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.usage_incremented',
          actorId: 'staff',
          payload: { amount: 3 },
        })
        yield* appendEvent(SubscriptionConfig, SUB_REF, {
          _tag: 'subscription.cancel_scheduled',
          actorId: 'owner',
          payload: { cancelledBy: 'owner', cancellationReason: 'mudou de cidade' },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(SUB_REF))!
    const replayed = await Effect.runPromise(
      replayAggregate(SubscriptionConfig, SUB_REF).pipe(Effect.provide(layer)),
    )

    // Replay == projeção, campo a campo (não só status/version): a prova de
    // que nenhum campo é escrito fora de eventos.
    expect(replayed).toEqual(projection)
    expect(replayed.status).toBe('active')
    expect(replayed.currentPeriod.consumed).toBe(3)
    expect(replayed.cancelAtPeriodEnd).toBe(true)
    expect(replayed._version).toBe(4)
  })

  it('Scenario 4: Typed errors propagam sem throw', async () => {
    const { layer } = makeReplayStore()

    const result = await Effect.runPromise(
      appendEvent(SubscriptionConfig, SUB_REF, {
        _tag: 'subscription.created' as const,
        actorId: 'owner',
        payload: { ...CREATED_PAYLOAD, customerId: 123 },
      }).pipe(
        Effect.catchTag('EventValidationError', (e) =>
          Effect.succeed({ caught: true, tag: e._tag, aggregateType: e.aggregateType }),
        ),
        Effect.provide(layer),
      ),
    )

    expect(result).toEqual({
      caught: true,
      tag: 'EventValidationError',
      aggregateType: 'subscription',
    })
  })
})
