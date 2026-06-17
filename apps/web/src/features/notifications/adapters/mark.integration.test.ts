// Integration test — #958, brief 0018 Grupo D.
//
// Runs against the Firebase emulator (firestore on 127.0.0.1:8080):
//   pnpm --filter @oilio/web db:start
//   pnpm --filter @oilio/web test:integration
//
// Cobre:
// - AC-16: markNotificationRead seta readAt + some do fetch (unread)
// - AC-17: snoozeNotification seta snoozedUntil + some do fetch até chegar

import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { markNotificationRead, snoozeNotification } from './mark'
import { fetchUnitNotifications } from './query'

const PROJECT_ID = 'scheduling-local'
const TZ = 'America/Sao_Paulo'

let app: App
let db: Firestore

beforeAll(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(app)
})

function uniqueTenantId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedNotif(tenantId: string, id: string, type = 'order_stale') {
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

describe('markNotificationRead (AC-16)', () => {
  it('sets readAt and removes from unread fetch', async () => {
    const tenantId = uniqueTenantId('read')
    await seedNotif(tenantId, 'n1')

    const before = await fetchUnitNotifications({ db, tenantId, unitId: 'u1', limit: 10 })
    expect(before.unreadCount).toBe(1)

    const r = await markNotificationRead(tenantId, 'n1', 'owner-1')
    expect(r.ok).toBe(true)

    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notifications')
      .doc('n1')
      .get()
    expect(snap.data()?.readAt).toBeTruthy()

    const after = await fetchUnitNotifications({ db, tenantId, unitId: 'u1', limit: 10 })
    expect(after.unreadCount).toBe(0)
  })
})

describe('snoozeNotification (AC-17)', () => {
  it('sets snoozedUntil future and hides from fetch until it passes', async () => {
    const tenantId = uniqueTenantId('snooze')
    await seedNotif(tenantId, 'n1')

    const now = new Date('2026-06-01T12:00:00.000Z')
    const r = await snoozeNotification({
      tenantId,
      notificationId: 'n1',
      option: '4h',
      actorUid: 'owner-1',
      tz: TZ,
      now,
    })
    expect(r.ok).toBe(true)

    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notifications')
      .doc('n1')
      .get()
    expect(snap.data()?.snoozedUntil).toBe('2026-06-01T16:00:00.000Z')

    // Antes do snoozedUntil → oculto
    const hidden = await fetchUnitNotifications({ db, tenantId, unitId: 'u1', limit: 10, now })
    expect(hidden.unreadCount).toBe(0)

    // Depois do snoozedUntil → reaparece
    const later = new Date('2026-06-01T17:00:00.000Z')
    const back = await fetchUnitNotifications({ db, tenantId, unitId: 'u1', limit: 10, now: later })
    expect(back.unreadCount).toBe(1)
  })

  it('rejects invalid via mark lib? (option validated at route) — snooze tomorrow sets 09:00 tz', async () => {
    const tenantId = uniqueTenantId('snooze-tomorrow')
    await seedNotif(tenantId, 'n1')

    const now = new Date('2026-06-01T14:00:00.000Z')
    const r = await snoozeNotification({
      tenantId,
      notificationId: 'n1',
      option: 'tomorrow',
      actorUid: 'owner-1',
      tz: TZ,
      now,
    })
    expect(r.ok).toBe(true)

    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notifications')
      .doc('n1')
      .get()
    expect(snap.data()?.snoozedUntil).toBe('2026-06-02T12:00:00.000Z')
  })
})
