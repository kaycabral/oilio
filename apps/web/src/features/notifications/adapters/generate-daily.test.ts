import { FirestoreService, type FirestoreDoc, type QueryConstraint } from '@/domain/effect'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { generateDailyNotifications } from './generate-daily'

function makeStore(initial: Record<string, FirestoreDoc> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    layer: Layer.succeed(FirestoreService, {
      getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
      getDocs: (collectionPath: string, constraints?: readonly QueryConstraint[]) => {
        const prefix = collectionPath + '/'
        let docs = [...store.entries()]
          .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map(([, doc]) => doc)

        if (constraints) {
          for (const c of constraints) {
            if (c.kind === 'where') {
              docs = docs.filter((doc) => {
                const val = doc[c.field]
                if (c.op === '==') return val === c.value
                if (c.op === 'in') return Array.isArray(c.value) && c.value.includes(val)
                return true
              })
            }
            if (c.kind === 'limit') {
              docs = docs.slice(0, c.count)
            }
          }
        }
        return Effect.succeed(docs)
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

describe('generateDailyNotifications', () => {
  it('creates birthday notification for matching customer', async () => {
    const { store, layer } = makeStore({
      'tenants/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'tenants/t1/units/u1': {
        id: 'u1',
        tenantId: 't1',
        businessHours: {
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: { open: '08:00', close: '18:00' },
          thursday: { open: '08:00', close: '18:00' },
          friday: { open: '08:00', close: '18:00' },
          saturday: null,
          sunday: null,
        },
      },
      'tenants/t1/customers/c1': { id: 'c1', userId: 'user-1' },
      'tenants/t1/customers/c2': { id: 'c2', userId: 'user-2' },
      // birthDate is PII — resolved from the global user doc, not the customer.
      'users/user-1': { birthDate: '1990-06-02' },
      'users/user-2': { birthDate: '1985-12-25' },
    })

    const now = new Date('2026-06-02T10:15:00.000Z')
    const created = await Effect.runPromise(
      generateDailyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(1)

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('tenants/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]![1]['type']).toBe('birthday')
    expect(notifications[0]![1]['customerId']).toBe('c1')
    expect(notifications[0]![1]['validUntil']).toBeTruthy()
  })

  it('creates subscription_expiring_tomorrow on D-1', async () => {
    const { store, layer } = makeStore({
      'tenants/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'tenants/t1/units/u1': {
        id: 'u1',
        tenantId: 't1',
        businessHours: {
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
      },
      'tenants/t1/subscriptions/s1': {
        id: 's1',
        tenantId: 't1',
        customerId: 'c1',
        status: 'active',
        currentPeriod: { startAt: '2026-05-01T03:00:00Z', endAt: '2026-06-03T03:00:00Z' },
      },
    })

    const now = new Date('2026-06-02T10:15:00.000Z')
    const created = await Effect.runPromise(
      generateDailyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(1)

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('tenants/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications[0]![1]['type']).toBe('subscription_expiring_tomorrow')
    expect(notifications[0]![1]['subscriptionId']).toBe('s1')
  })

  it('creates subscription_expired on D+1', async () => {
    const { store, layer } = makeStore({
      'tenants/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'tenants/t1/units/u1': {
        id: 'u1',
        tenantId: 't1',
        businessHours: {
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
      },
      'tenants/t1/subscriptions/s1': {
        id: 's1',
        tenantId: 't1',
        customerId: 'c1',
        status: 'active',
        currentPeriod: { startAt: '2026-05-01T03:00:00Z', endAt: '2026-06-01T03:00:00Z' },
      },
    })

    const now = new Date('2026-06-02T10:15:00.000Z')
    const created = await Effect.runPromise(
      generateDailyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(1)

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('tenants/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications[0]![1]['type']).toBe('subscription_expired')
  })

  it('creates subscription_overdue_followup on D+7', async () => {
    const { store, layer } = makeStore({
      'tenants/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'tenants/t1/units/u1': {
        id: 'u1',
        tenantId: 't1',
        businessHours: {
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
      },
      'tenants/t1/subscriptions/s1': {
        id: 's1',
        tenantId: 't1',
        customerId: 'c1',
        status: 'past_due',
        currentPeriod: { startAt: '2026-05-01T03:00:00Z', endAt: '2026-05-26T03:00:00Z' },
      },
    })

    const now = new Date('2026-06-02T10:15:00.000Z')
    const created = await Effect.runPromise(
      generateDailyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(1)

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('tenants/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications[0]![1]['type']).toBe('subscription_overdue_followup')
  })

  it('idempotent — second run does not duplicate', async () => {
    const { store, layer } = makeStore({
      'tenants/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'tenants/t1/units/u1': {
        id: 'u1',
        tenantId: 't1',
        businessHours: {
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: { open: '08:00', close: '18:00' },
          thursday: { open: '08:00', close: '18:00' },
          friday: { open: '08:00', close: '18:00' },
          saturday: null,
          sunday: null,
        },
      },
      'tenants/t1/customers/c1': { id: 'c1', userId: 'user-1' },
      'users/user-1': { birthDate: '1990-06-02' },
    })

    const now = new Date('2026-06-02T10:15:00.000Z')
    await Effect.runPromise(generateDailyNotifications(now).pipe(Effect.provide(layer)))
    const firstCount = [...store.entries()]
      .filter(([key]) => key.startsWith('tenants/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/')).length

    await Effect.runPromise(generateDailyNotifications(now).pipe(Effect.provide(layer)))
    const secondCount = [...store.entries()]
      .filter(([key]) => key.startsWith('tenants/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/')).length

    expect(firstCount).toBe(1)
    expect(secondCount).toBe(1)
  })

  it('skips unit outside processing window', async () => {
    const { layer } = makeStore({
      'tenants/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'tenants/t1/units/u1': {
        id: 'u1',
        tenantId: 't1',
        businessHours: {
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: { open: '08:00', close: '18:00' },
          thursday: { open: '08:00', close: '18:00' },
          friday: { open: '08:00', close: '18:00' },
          saturday: null,
          sunday: null,
        },
      },
      'tenants/t1/customers/c1': { id: 'c1', userId: 'user-1', birthDate: '1990-06-02' },
    })

    const now = new Date('2026-06-02T14:00:00.000Z')
    const created = await Effect.runPromise(
      generateDailyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(0)
  })
})
