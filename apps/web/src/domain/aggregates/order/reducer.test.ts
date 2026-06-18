import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { EventEnvelope, EventMeta } from '@/domain/effect/event-store'
import { appendEvent, type EventValidationError } from '@/domain/effect/event-store'
import type { FirestoreDoc } from '@/domain/effect/services'
import { FirestoreService } from '@/domain/effect/services'
import type { Order } from '@/domain/types/order'
import { buildReactor, type EventReaction } from '../_shared/reactions'
import { SubscriptionConfig } from '../subscription/config'
import { applyOrderEvent } from './reducer'
import { INITIAL_ORDER_STATE } from './types'

function meta(version: number, timestamp = '2026-06-01T10:00:00Z'): EventMeta {
  return { version, timestamp, actorId: 'user-1', schemaVersion: 1 }
}

const ITEM = {
  id: 'i1',
  kind: 'service' as const,
  refId: 's1',
  name: 'Corte',
  quantity: 1,
  unitPriceCents: 5000,
  commission: null,
  attributedUserId: 'p1',
}

describe('Order reducer', () => {
  it('created projeta o snapshot completo da comanda', () => {
    const data: Order = {
      id: 'o1',
      orgId: 't1',
      unitId: 'u1',
      customerId: 'c1',
      appointmentId: 'a1',
      status: 'open',
      items: [],
      discountCents: 0,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: 0,
      totalCents: 0,
      createdAt: '2026-06-01T10:00:00Z',
      updatedAt: '2026-06-01T10:00:00Z',
    }
    const state = applyOrderEvent(INITIAL_ORDER_STATE, { _tag: 'order.created', data }, meta(1))

    expect(state.status).toBe('open')
    expect(state.customerId).toBe('c1')
    expect(state.unitId).toBe('u1')
  })

  it('created projeta venda avulsa sem cliente (appointmentId/customerId null — brief 0030)', () => {
    const data: Order = {
      id: 'o2',
      orgId: 't1',
      unitId: 'u1',
      customerId: null,
      appointmentId: null,
      status: 'open',
      items: [],
      discountCents: 0,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: 0,
      totalCents: 0,
      createdAt: '2026-06-03T10:00:00Z',
      updatedAt: '2026-06-03T10:00:00Z',
    }
    const state = applyOrderEvent(INITIAL_ORDER_STATE, { _tag: 'order.created', data }, meta(1))

    expect(state.status).toBe('open')
    expect(state.customerId).toBeNull()
    expect(state.appointmentId).toBeNull()
  })

  it('item_added/meta_updated projetam o patch recalculado (items + totais)', () => {
    const open = { ...INITIAL_ORDER_STATE, status: 'open' as const, _version: 1 }

    const s1 = applyOrderEvent(
      open,
      {
        _tag: 'order.item_added',
        changes: { items: [ITEM], subtotalCents: 5000, totalCents: 5000 },
      },
      meta(2),
    )
    const s2 = applyOrderEvent(
      s1,
      {
        _tag: 'order.meta_updated',
        changes: { discountCents: 1000, subtotalCents: 5000, totalCents: 4000 },
      },
      meta(3),
    )

    expect(s1.items).toHaveLength(1)
    expect(s2.totalCents).toBe(4000)
    expect(s2.discountCents).toBe(1000)
  })

  it('cancelled marca o status', () => {
    const open = { ...INITIAL_ORDER_STATE, status: 'open' as const, items: [ITEM], _version: 2 }
    const state = applyOrderEvent(open, { _tag: 'order.cancelled' }, meta(3))
    expect(state.status).toBe('cancelled')
    expect(state.items).toHaveLength(1)
  })

  it('closed projeta snapshot (closedAt/subtotal/total/paymentMethod)', () => {
    const open = { ...INITIAL_ORDER_STATE, totalCents: 8000, _version: 3 }

    const state = applyOrderEvent(
      open,
      {
        _tag: 'order.closed',
        closedAt: '2026-06-01T12:00:00Z',
        subtotalCents: 8000,
        totalCents: 8000,
        paymentMethod: 'pix',
      },
      meta(4),
    )

    expect(state.status).toBe('closed')
    expect(state.paymentMethod).toBe('pix')
    expect(state.closedAt).toBe('2026-06-01T12:00:00Z')
    expect(state.subtotalCents).toBe(8000)
  })

  it('reopened returns to open and clears payment method, keeping items (#946)', () => {
    const closed = {
      ...INITIAL_ORDER_STATE,
      status: 'closed' as const,
      items: [ITEM],
      totalCents: 8000,
      closedAt: '2026-06-01T12:00:00Z',
      paymentMethod: 'pix' as const,
      _version: 4,
    }

    const state = applyOrderEvent(
      closed,
      {
        _tag: 'order.reopened',
        commissionsReversed: 1,
        cashReversalMovementId: 'cm_estorno',
        subscriptionRestored: true,
      },
      meta(5),
    )

    expect(state.status).toBe('open')
    expect(state.paymentMethod).toBeNull()
    // Conteúdo da order preservado ao reabrir.
    expect(state.totalCents).toBe(8000)
    expect(state.items).toHaveLength(1)
  })
})

describe('AC-10: cross-aggregate event reaction', () => {
  it('order.closed triggers subscription.usage_incremented via reactor', async () => {
    const emitted: { tag: string; path: string }[] = []

    const orderClosedReaction: EventReaction<FirestoreService, EventValidationError> = {
      trigger: 'order.closed',
      handle: (env) =>
        Effect.gen(function* () {
          const subscriptionPath = `orgs/t1/subscriptions/s1`
          yield* appendEvent(SubscriptionConfig, subscriptionPath, {
            _tag: 'subscription.usage_incremented',
            actorId: env.actorId,
            payload: { amount: 1 },
          })
          emitted.push({ tag: 'subscription.usage_incremented', path: subscriptionPath })
        }),
    }

    const reactor = buildReactor([orderClosedReaction])

    const store = new Map<string, FirestoreDoc>()
    store.set('orgs/t1/subscriptions/s1', {
      _version: 5,
      status: 'active',
      currentPeriod: {
        startAt: '2026-06-01T00:00:00.000Z',
        endAt: '2026-07-01T00:00:00.000Z',
        consumed: 3,
      },
    })

    const layer = Layer.succeed(FirestoreService, {
      getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
      getDocs: (collectionPath: string) =>
        Effect.succeed(
          [...store.entries()]
            .filter(([key]) => key.startsWith(collectionPath + '/'))
            .map(([, doc]) => doc),
        ),
      setDoc: (path: string, data: FirestoreDoc) =>
        Effect.sync(() => {
          store.set(path, { ...store.get(path), ...data })
        }),
      runTransaction: (fn) =>
        fn({
          getDoc: (path) => Effect.succeed(store.get(path) ?? null),
          setDoc: (path, data) =>
            Effect.sync(() => {
              store.set(path, { ...store.get(path), ...data })
            }),
        }),
    })

    const orderClosedEnvelope: EventEnvelope = {
      _tag: 'order.closed',
      version: 4,
      timestamp: '2026-06-01T12:00:00Z',
      actorId: 'user-1',
      schemaVersion: 1,
      payload: {
        closedAt: '2026-06-01T12:00:00Z',
        subtotalCents: 8000,
        totalCents: 8000,
        paymentMethod: 'pix',
      },
    }

    await Effect.runPromise(reactor(orderClosedEnvelope).pipe(Effect.provide(layer)))

    expect(emitted).toEqual([
      { tag: 'subscription.usage_incremented', path: 'orgs/t1/subscriptions/s1' },
    ])

    const subProjection = store.get('orgs/t1/subscriptions/s1')
    const currentPeriod = subProjection?.['currentPeriod']
    const consumed =
      typeof currentPeriod === 'object' && currentPeriod !== null && 'consumed' in currentPeriod
        ? currentPeriod.consumed
        : undefined
    expect(consumed).toBe(4)
  })

  it('AC-10: reactor does nothing for events without registered reactions', async () => {
    const reactor = buildReactor<never, never>([])

    const env: EventEnvelope = {
      _tag: 'order.created',
      version: 1,
      timestamp: '2026-06-01T10:00:00Z',
      actorId: 'u1',
      schemaVersion: 1,
      payload: {},
    }

    await Effect.runPromise(reactor(env))
  })
})
