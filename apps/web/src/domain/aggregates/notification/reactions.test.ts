import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { EventEnvelope } from '@/domain/effect/event-store'
import type { FirestoreDoc, QueryConstraint } from '@/domain/effect/services'
import { FirestoreService } from '@/domain/effect/services'
import { buildReactor } from '../_shared/reactions'
import { notificationReactions } from './reactions'

function makeStore(initial: Record<string, FirestoreDoc> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    layer: Layer.succeed(FirestoreService, {
      getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
      getDocs: (collectionPath: string, constraints?: readonly QueryConstraint[]) => {
        const prefix = collectionPath + '/'
        const allDocs = [...store.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, doc]) => doc)

        if (!constraints) return Effect.succeed(allDocs)

        let filtered = allDocs
        for (const c of constraints) {
          if (c.kind === 'where') {
            filtered = filtered.filter((doc) => {
              const val = doc[c.field]
              if (c.op === '==') return val === c.value
              if (c.op === 'in') return Array.isArray(c.value) && c.value.includes(val)
              return true
            })
          }
          if (c.kind === 'limit') {
            filtered = filtered.slice(0, c.count)
          }
        }
        return Effect.succeed(filtered)
      },
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
    }),
  }
}

describe('Notification reactions', () => {
  it('customer.created creates notification for each unit', async () => {
    const { store, layer } = makeStore({
      'orgs/t1/units/u1': { id: 'u1', orgId: 't1', name: 'Unit 1' },
      'orgs/t1/units/u2': { id: 'u2', orgId: 't1', name: 'Unit 2' },
      // A malformed unit doc with no `id` must be skipped (not a 3rd notif).
      'orgs/t1/units/broken': { orgId: 't1', name: 'No Id' },
    })

    const reactor = buildReactor([...notificationReactions])

    const envelope: EventEnvelope = {
      _tag: 'customer.created',
      version: 1,
      timestamp: '2026-06-01T10:00:00Z',
      actorId: 'c1',
      schemaVersion: 1,
      payload: { orgId: 't1', name: 'João', whatsapp: '5511999999999' },
    }

    await Effect.runPromise(reactor(envelope).pipe(Effect.provide(layer)))

    const projections = [...store.entries()]
      .filter(([key]) => key.startsWith('orgs/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))
      .map(([, doc]) => doc)

    expect(projections).toHaveLength(2)

    const u1 = projections.find((n) => n['unitId'] === 'u1')!
    expect(u1['type']).toBe('new_customer')
    expect(u1['source']).toBe('event')
    expect(u1['customerId']).toBe('c1')
    expect(u1['subscriptionId']).toBeNull()
    expect(u1['validUntil']).toBeNull()
    expect(u1['eventKey']).toBe('new_customer-c1-unit-u1')
    expect(u1['payload']).toEqual({ customerName: 'João', customerWhatsapp: '5511999999999' })
  })

  it('customer.created is idempotent — does not duplicate', async () => {
    const { store, layer } = makeStore({
      'orgs/t1/units/u1': { id: 'u1', orgId: 't1', name: 'Unit 1' },
    })

    const reactor = buildReactor([...notificationReactions])

    const envelope: EventEnvelope = {
      _tag: 'customer.created',
      version: 1,
      timestamp: '2026-06-01T10:00:00Z',
      actorId: 'c1',
      schemaVersion: 1,
      payload: { orgId: 't1', name: 'João', whatsapp: '5511999999999' },
    }

    await Effect.runPromise(reactor(envelope).pipe(Effect.provide(layer)))
    await Effect.runPromise(reactor(envelope).pipe(Effect.provide(layer)))

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('orgs/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications).toHaveLength(1)
  })

  it('subscription.charge_failed creates payment_failure for all units', async () => {
    const { store, layer } = makeStore({
      'orgs/t1/units/u1': { id: 'u1', orgId: 't1', name: 'Unit 1' },
    })

    const reactor = buildReactor([...notificationReactions])

    const envelope: EventEnvelope = {
      _tag: 'subscription.charge_failed',
      version: 3,
      timestamp: '2026-06-01T10:00:00Z',
      actorId: 'owner-1',
      schemaVersion: 1,
      payload: { reason: 'card_declined', orgId: 't1', subscriptionId: 's1' },
    }

    await Effect.runPromise(reactor(envelope).pipe(Effect.provide(layer)))

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('orgs/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications).toHaveLength(1)
    const notif = notifications[0]![1]
    expect(notif['type']).toBe('payment_failure')
    expect(notif['customerId']).toBeNull()
    expect(notif['subscriptionId']).toBe('s1')
    expect(notif['eventKey']).toBe('payment_failure-sub-s1-v3-unit-u1')
    expect(notif['payload']).toEqual({ reason: 'card_declined', subscriptionId: 's1' })
  })

  it('subscription.activated expires pending subscription notifications', async () => {
    const notifId = 'notif-1'
    const { store, layer } = makeStore({
      [`orgs/t1/notifications/${notifId}`]: {
        id: notifId,
        orgId: 't1',
        unitId: 'u1',
        type: 'subscription_expiring_tomorrow',
        subscriptionId: 's1',
        dispatchedAt: null,
        _version: 1,
      },
    })

    const reactor = buildReactor([...notificationReactions])

    const envelope: EventEnvelope = {
      _tag: 'subscription.activated',
      version: 2,
      timestamp: '2026-06-01T10:00:00Z',
      actorId: 'owner-1',
      schemaVersion: 1,
      payload: { orgId: 't1', subscriptionId: 's1' },
    }

    await Effect.runPromise(reactor(envelope).pipe(Effect.provide(layer)))

    const notif = store.get(`orgs/t1/notifications/${notifId}`)
    expect(notif!['validUntil']).toBeTruthy()
    expect(notif!['_version']).toBe(2)
  })

  it('subscription.activated expires every expiry type for the subscription, and nothing else', async () => {
    function notif(id: string, over: Record<string, unknown>) {
      return {
        [`orgs/t1/notifications/${id}`]: {
          id,
          orgId: 't1',
          unitId: 'u1',
          subscriptionId: 's1',
          dispatchedAt: null,
          _version: 1,
          ...over,
        },
      }
    }
    const { store, layer } = makeStore({
      // All three expiry types for s1 → expired.
      ...notif('n-tomorrow', { type: 'subscription_expiring_tomorrow' }),
      ...notif('n-expired', { type: 'subscription_expired' }),
      ...notif('n-overdue', { type: 'subscription_overdue_followup' }),
      // Non-expiry type → kept (the includes() guard).
      ...notif('n-birthday', { type: 'birthday' }),
      // Different subscription → kept (the subscriptionId where-constraint).
      ...notif('n-other-sub', { type: 'subscription_expired', subscriptionId: 's2' }),
      // Already dispatched → kept (the dispatchedAt==null where-constraint).
      ...notif('n-dispatched', {
        type: 'subscription_expired',
        dispatchedAt: '2026-05-01T00:00:00Z',
      }),
    })

    const reactor = buildReactor([...notificationReactions])
    const envelope: EventEnvelope = {
      _tag: 'subscription.activated',
      version: 9,
      timestamp: '2026-06-01T10:00:00Z',
      actorId: 'owner-1',
      schemaVersion: 1,
      payload: { orgId: 't1', subscriptionId: 's1' },
    }

    await Effect.runPromise(reactor(envelope).pipe(Effect.provide(layer)))

    const isExpired = (id: string) =>
      Boolean(store.get(`orgs/t1/notifications/${id}`)?.['validUntil'])

    expect(isExpired('n-tomorrow')).toBe(true)
    expect(isExpired('n-expired')).toBe(true)
    expect(isExpired('n-overdue')).toBe(true)
    expect(isExpired('n-birthday')).toBe(false)
    expect(isExpired('n-other-sub')).toBe(false)
    expect(isExpired('n-dispatched')).toBe(false)
  })
})
