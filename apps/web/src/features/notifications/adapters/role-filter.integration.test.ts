// Integration test — #959, brief 0018 Grupo E.
//
// Runs against the Firebase emulator (firestore on 127.0.0.1:8080):
//   pnpm --filter @oilio/web db:start
//   pnpm --filter @oilio/web test:integration
//
// AC-18/19: fetchUnitNotifications com allowedTypes (derivado do role) — count
// + items respeitam a visibilidade. Receptionist não vê tipos financeiros.

import { allowedNotificationTypesForRole } from '@/domain'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchUnitNotifications } from './query'

const PROJECT_ID = 'scheduling-local'

let app: App
let db: Firestore

beforeAll(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(app)
})

function uniqueTenantId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

async function seed(tenantId: string, id: string, type: string) {
  await db
    .collection('tenants')
    .doc(tenantId)
    .collection('notifications')
    .doc(id)
    .set({
      id,
      tenantId,
      unitId: 'u1',
      type,
      customerId: null,
      appointmentId: null,
      subscriptionId: null,
      payload: {},
      source: 'cron',
      eventKey: `${id}-key`,
      createdAt: '2026-06-01T10:00:00.000Z',
      readAt: null,
      dispatchedAt: null,
      dispatchedChannel: null,
      dispatchedBody: null,
      validUntil: null,
      snoozedUntil: null,
      _version: 1,
    })
}

describe('fetchUnitNotifications role filter (AC-18/19)', () => {
  it('receptionist não vê cash_register_open nem payment_failure', async () => {
    const tenantId = uniqueTenantId('recep')
    await seed(tenantId, 'birthday', 'birthday')
    await seed(tenantId, 'cash', 'cash_register_open')
    await seed(tenantId, 'pay', 'payment_failure')
    await seed(tenantId, 'order', 'order_stale')

    const allowed = allowedNotificationTypesForRole('receptionist')
    const res = await fetchUnitNotifications({
      db,
      tenantId,
      unitId: 'u1',
      limit: 10,
      now: new Date(),
      allowedTypes: allowed,
    })

    const types = res.items.map((n) => n.type).sort()
    expect(types).toEqual(['birthday', 'order_stale'])
    expect(res.unreadCount).toBe(2)
  })

  it('manager vê tudo', async () => {
    const tenantId = uniqueTenantId('mgr')
    await seed(tenantId, 'birthday', 'birthday')
    await seed(tenantId, 'cash', 'cash_register_open')
    await seed(tenantId, 'pay', 'payment_failure')

    const allowed = allowedNotificationTypesForRole('manager')
    const res = await fetchUnitNotifications({
      db,
      tenantId,
      unitId: 'u1',
      limit: 10,
      now: new Date(),
      allowedTypes: allowed,
    })

    expect(res.unreadCount).toBe(3)
  })

  it('sem allowedTypes → sem filtro de role (count total)', async () => {
    const tenantId = uniqueTenantId('noflt')
    await seed(tenantId, 'cash', 'cash_register_open')
    const res = await fetchUnitNotifications({ db, tenantId, unitId: 'u1', limit: 10 })
    expect(res.unreadCount).toBe(1)
  })
})
