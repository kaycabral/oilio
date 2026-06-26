import { type FirestoreDoc } from '@/domain/effect'
import { makeReplayStore } from '@/domain/effect/test-layers'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

// Post-cutover (#1202) the daily sweep enumerates tenants from the PUBLIC org
// directory (Postgres, no RLS) via `listAllOrgIds`, and resolves each customer's
// birthDate PII from the global `users` table via `getUserById` (NOT the
// org-scoped customer doc). Both are mocked so the test stays a pure unit (no DB):
// `listAllOrgIds` returns the fixture's single org; `getUserById` reads the
// `users/{uid}` entries seeded into the in-memory store below.
const mocks = vi.hoisted(() => ({
  listAllOrgIds: vi.fn(() => Promise.resolve(['t1'])),
  usersByUid: new Map<string, Record<string, unknown>>(),
}))
vi.mock('@/shared/db/pg/public-org-directory', () => ({ listAllOrgIds: mocks.listAllOrgIds }))
vi.mock('@/shared/db/pg/users-store', () => ({
  getUserById: (uid: string) => Promise.resolve(mocks.usersByUid.get(uid) ?? null),
}))

import { generateDailyNotifications } from './generate-daily'

function makeStore(initial: Record<string, FirestoreDoc> = {}) {
  // D6: the in-memory port is ref-keyed (`${type}/${orgId}/${id}`). Seed
  // projections under those keys; `users/{uid}` is a non-aggregate global path
  // (no RLS, no org_id) read via the mocked users-store, so it stays a plain key.
  const { store, layer } = makeReplayStore(initial)
  // Seed the mocked `getUserById` from the store's global `users/{uid}` entries —
  // mirrors the production join (customer.userId → users table) without a DB.
  mocks.usersByUid.clear()
  for (const [key, doc] of store) {
    if (key.startsWith('users/')) mocks.usersByUid.set(key.slice('users/'.length), doc)
  }
  return { store, layer }
}

describe('generateDailyNotifications', () => {
  it('creates birthday notification for matching customer', async () => {
    const { store, layer } = makeStore({
      'unit/t1/u1': {
        id: 'u1',
        orgId: 't1',
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
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
      },
      'customer/t1/c1': { id: 'c1', userId: 'user-1' },
      'customer/t1/c2': { id: 'c2', userId: 'user-2' },
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
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]![1]['type']).toBe('birthday')
    expect(notifications[0]![1]['customerId']).toBe('c1')
    expect(notifications[0]![1]['validUntil']).toBeTruthy()
  })

  it('creates subscription_expiring_tomorrow on D-1', async () => {
    const { store, layer } = makeStore({
      'unit/t1/u1': {
        id: 'u1',
        orgId: 't1',
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
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
      },
      'subscription/t1/s1': {
        id: 's1',
        orgId: 't1',
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
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications[0]![1]['type']).toBe('subscription_expiring_tomorrow')
    expect(notifications[0]![1]['subscriptionId']).toBe('s1')
  })

  it('creates subscription_expired on D+1', async () => {
    const { store, layer } = makeStore({
      'unit/t1/u1': {
        id: 'u1',
        orgId: 't1',
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
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
      },
      'subscription/t1/s1': {
        id: 's1',
        orgId: 't1',
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
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications[0]![1]['type']).toBe('subscription_expired')
  })

  it('creates subscription_overdue_followup on D+7', async () => {
    const { store, layer } = makeStore({
      'unit/t1/u1': {
        id: 'u1',
        orgId: 't1',
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
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
      },
      'subscription/t1/s1': {
        id: 's1',
        orgId: 't1',
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
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications[0]![1]['type']).toBe('subscription_overdue_followup')
  })

  it('idempotent — second run does not duplicate', async () => {
    const { store, layer } = makeStore({
      'unit/t1/u1': {
        id: 'u1',
        orgId: 't1',
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
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
      },
      'customer/t1/c1': { id: 'c1', userId: 'user-1' },
      'users/user-1': { birthDate: '1990-06-02' },
    })

    const now = new Date('2026-06-02T10:15:00.000Z')
    await Effect.runPromise(generateDailyNotifications(now).pipe(Effect.provide(layer)))
    const firstCount = [...store.entries()]
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/')).length

    await Effect.runPromise(generateDailyNotifications(now).pipe(Effect.provide(layer)))
    const secondCount = [...store.entries()]
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/')).length

    expect(firstCount).toBe(1)
    expect(secondCount).toBe(1)
  })

  it('skips unit outside processing window', async () => {
    const { layer } = makeStore({
      'unit/t1/u1': {
        id: 'u1',
        orgId: 't1',
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
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
      },
      'customer/t1/c1': { id: 'c1', userId: 'user-1', birthDate: '1990-06-02' },
    })

    const now = new Date('2026-06-02T14:00:00.000Z')
    const created = await Effect.runPromise(
      generateDailyNotifications(now).pipe(Effect.provide(layer)),
    )

    expect(created).toBe(0)
  })
})
