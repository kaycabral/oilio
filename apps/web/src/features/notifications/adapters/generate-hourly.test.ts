import { type FirestoreDoc } from '@/domain/effect'
import { makeReplayStore } from '@/domain/effect/test-layers'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

// Post-cutover (#1202) the sweep enumerates tenants from the PUBLIC org directory
// (Postgres, no RLS) via `listAllOrgIds`. Mock it to the fixture's single org so
// the test stays a pure unit (no DB); each org's data still flows through the
// in-memory `PersistencePort` layer below.
const mocks = vi.hoisted(() => ({ listAllOrgIds: vi.fn(() => Promise.resolve(['t1'])) }))
vi.mock('@/shared/db/pg/public-org-directory', () => ({ listAllOrgIds: mocks.listAllOrgIds }))

import { generateHourlyNotifications } from './generate-hourly'

// D6: the in-memory port is ref-keyed (`${type}/${orgId}/${id}`); seed
// projections under those keys (`unit/t1/u1`, `order/t1/o1`, ...).
function makeStore(initial: Record<string, FirestoreDoc> = {}) {
  return makeReplayStore(initial)
}

describe('generateHourlyNotifications', () => {
  it('creates order_stale when service ended + threshold passed', async () => {
    const serviceStart = '2026-06-02T08:00:00Z'
    const durationMinutes = 60
    const { store, layer } = makeStore({
      'unit/t1/u1': { id: 'u1', orgId: 't1' },
      'order/t1/o1': {
        id: 'o1',
        orgId: 't1',
        status: 'open',
        appointmentId: 'a1',
      },
      'appointment/t1/a1': {
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
      .filter(([key]) => key.startsWith('notification/t1/'))
      .filter(([key]) => !key.includes('/events/'))

    expect(notifications).toHaveLength(1)
    expect(notifications[0]![1]['type']).toBe('order_stale')
  })

  it('does not create order_stale before threshold', async () => {
    const { layer } = makeStore({
      'unit/t1/u1': { id: 'u1', orgId: 't1' },
      'order/t1/o1': {
        id: 'o1',
        orgId: 't1',
        status: 'open',
        appointmentId: 'a1',
      },
      'appointment/t1/a1': {
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
