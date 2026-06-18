// Integration test for fetchUnitNotifications (#955, brief 0018 Grupo A).
//
// Runs against the Firebase emulator (firestore on 127.0.0.1:8080):
//   pnpm --filter @oilio/web db:start
//   pnpm --filter @oilio/web test:integration
//
// Contract:
// - unread = readAt null AND dispatchedAt null AND unitId match
// - unreadCount counts ALL unread for the unit (not limited)
// - items returns top N by createdAt desc
// - notifications de outras unidades NÃO aparecem (isolamento por unidade)

import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchUnitNotifications } from './query'

const PROJECT_ID = `notif-query-${Date.now()}`

let app: App
let db: Firestore

beforeAll(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(app)
})

function uniqueOrgId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

type SeedOpts = {
  unitId: string
  type?: string
  createdAt: string
  readAt?: string | null
  dispatchedAt?: string | null
}

async function seed(orgId: string, id: string, opts: SeedOpts) {
  await db
    .collection('orgs')
    .doc(orgId)
    .collection('notifications')
    .doc(id)
    .set({
      id,
      orgId,
      unitId: opts.unitId,
      type: opts.type ?? 'birthday',
      customerId: null,
      appointmentId: null,
      subscriptionId: null,
      payload: {},
      source: 'cron',
      eventKey: `${id}-key`,
      createdAt: opts.createdAt,
      readAt: opts.readAt ?? null,
      dispatchedAt: opts.dispatchedAt ?? null,
      validUntil: null,
      snoozedUntil: null,
      _version: 1,
    })
}

describe('fetchUnitNotifications (integration)', () => {
  it('counts unread + returns top N for the unit', async () => {
    const orgId = uniqueOrgId('topn')
    await seed(orgId, 'n1', { unitId: 'u1', createdAt: '2026-06-01T10:00:00.000Z' })
    await seed(orgId, 'n2', { unitId: 'u1', createdAt: '2026-06-01T11:00:00.000Z' })
    await seed(orgId, 'n3', { unitId: 'u1', createdAt: '2026-06-01T12:00:00.000Z' })

    const result = await fetchUnitNotifications({ db, orgId, unitId: 'u1', limit: 2 })

    expect(result.unreadCount).toBe(3)
    expect(result.items).toHaveLength(2)
    // mais recentes primeiro
    expect(result.items[0]!.id).toBe('n3')
    expect(result.items[1]!.id).toBe('n2')
  })

  it('excludes read and dispatched notifications', async () => {
    const orgId = uniqueOrgId('readstate')
    await seed(orgId, 'unread', { unitId: 'u1', createdAt: '2026-06-01T10:00:00.000Z' })
    await seed(orgId, 'read', {
      unitId: 'u1',
      createdAt: '2026-06-01T11:00:00.000Z',
      readAt: '2026-06-01T11:30:00.000Z',
    })
    await seed(orgId, 'dispatched', {
      unitId: 'u1',
      createdAt: '2026-06-01T12:00:00.000Z',
      dispatchedAt: '2026-06-01T12:30:00.000Z',
    })

    const result = await fetchUnitNotifications({ db, orgId, unitId: 'u1', limit: 10 })

    expect(result.unreadCount).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.id).toBe('unread')
  })

  it('isolates by unit — does not leak other units', async () => {
    const orgId = uniqueOrgId('isolation')
    await seed(orgId, 'u1-a', { unitId: 'u1', createdAt: '2026-06-01T10:00:00.000Z' })
    await seed(orgId, 'u2-a', { unitId: 'u2', createdAt: '2026-06-01T11:00:00.000Z' })
    await seed(orgId, 'u2-b', { unitId: 'u2', createdAt: '2026-06-01T12:00:00.000Z' })

    const result = await fetchUnitNotifications({ db, orgId, unitId: 'u1', limit: 10 })

    expect(result.unreadCount).toBe(1)
    expect(result.items.every((n) => n.unitId === 'u1')).toBe(true)
  })

  it('empty state: 0 unread → count 0 + empty items', async () => {
    const orgId = uniqueOrgId('empty')
    const result = await fetchUnitNotifications({ db, orgId, unitId: 'u1', limit: 10 })

    expect(result.unreadCount).toBe(0)
    expect(result.items).toHaveLength(0)
  })
})
