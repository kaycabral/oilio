import {
  PersistencePort,
  type FirestoreDoc,
  type PersistenceOps,
  type QueryConstraint,
} from '@/domain/effect'
import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'

// Post-cutover (#1202) the sweep enumerates tenants from the PUBLIC org directory
// (Postgres, no RLS) via `listAllOrgIds`. Mock it to the fixture's single org so
// the test stays a pure unit (no DB); each org's data still flows through the
// in-memory `PersistencePort` layer below.
const mocks = vi.hoisted(() => ({ listAllOrgIds: vi.fn(() => Promise.resolve(['t1'])) }))
vi.mock('@/shared/db/pg/public-org-directory', () => ({ listAllOrgIds: mocks.listAllOrgIds }))

import { generateHourlyNotifications } from './generate-hourly'

function makeStore(initial: Record<string, FirestoreDoc> = {}) {
  const store = new Map(Object.entries(initial))
  const ops: PersistenceOps = {
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
  }
  return {
    store,
    layer: Layer.succeed(PersistencePort, ops),
  }
}

describe('generateHourlyNotifications', () => {
  it('creates order_stale when service ended + threshold passed', async () => {
    const serviceStart = '2026-06-02T08:00:00Z'
    const durationMinutes = 60
    const { store, layer } = makeStore({
      'orgs/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'orgs/t1/units/u1': { id: 'u1', orgId: 't1' },
      'orgs/t1/orders/o1': {
        id: 'o1',
        orgId: 't1',
        status: 'open',
        appointmentId: 'a1',
      },
      'orgs/t1/appointments/a1': {
        id: 'a1',
        unitId: 'u1',
        startAt: serviceStart,
        serviceDurationMinutesSnapshot: durationMinutes,
      },
    })

    const now = new Date('2026-06-02T12:00:00Z')
    const created = await Effect.runPromise(
      generateHourlyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(1)

    const notifications = [...store.entries()]
      .filter(([key]) => key.startsWith('orgs/t1/notifications/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]![1]['type']).toBe('order_stale')
  })

  it('does not create order_stale before threshold', async () => {
    const { layer } = makeStore({
      'orgs/t1': { id: 't1', timezone: 'America/Sao_Paulo' },
      'orgs/t1/units/u1': { id: 'u1', orgId: 't1' },
      'orgs/t1/orders/o1': {
        id: 'o1',
        orgId: 't1',
        status: 'open',
        appointmentId: 'a1',
      },
      'orgs/t1/appointments/a1': {
        id: 'a1',
        unitId: 'u1',
        startAt: '2026-06-02T08:00:00Z',
        serviceDurationMinutesSnapshot: 60,
      },
    })

    const now = new Date('2026-06-02T10:30:00Z')
    const created = await Effect.runPromise(
      generateHourlyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(0)
  })
})
