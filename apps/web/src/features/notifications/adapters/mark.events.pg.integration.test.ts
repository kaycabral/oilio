// Postgres integration test — #958, brief 0018 Grupo D (re-substrated to
// Postgres by the cutover, #1202).
//
// Runs against the ephemeral `oilio` Postgres (OILIO_DATABASE_URL); the
// event-store globalSetup applies the migrations.
//
// Cobre:
// - AC-16: markNotificationRead seta read_at + some do fetch (unread)
// - AC-17: snoozeNotification seta snoozed_until + some do fetch até chegar
//
// The notification is created through the REAL event store (`notification.created`
// over the Postgres layer), then `markNotificationRead`/`snoozeNotification`
// (which `emitEvent` `notification.read`/`notification.snoozed`) drive the
// projection — exactly the production write path. Reads go through the live
// `fetchUnreadNotificationsForUnit`; the read_at/snoozed_until snapshots are
// verified with a direct row read over the superuser pool.

import { NotificationConfig } from '@/domain/aggregates'
import { appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { fetchUnreadNotificationsForUnit } from '@/shared/org/notification-read'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { markNotificationRead, snoozeNotification } from './mark'

const TZ = 'America/Sao_Paulo'

function uniqueOrgId(label: string): string {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$2,$2,1,'Org','slug-'||$2,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [`orgs/${orgId}`, orgId],
  )
}

// Creates a notification through the event store (`notification.created`), the
// same append the cron generator runs — so the aggregate has real history for
// the read/snooze events to fold over.
async function seedNotif(orgId: string, id: string, type = 'order_stale'): Promise<void> {
  await Effect.runPromise(
    appendEvent(NotificationConfig, `orgs/${orgId}/notifications/${id}`, {
      _tag: 'notification.created',
      actorId: 'test',
      payload: {
        orgId,
        unitId: 'u1',
        type,
        customerId: null,
        appointmentId: null,
        subscriptionId: null,
        payload: {},
        source: 'cron',
        eventKey: `${id}-key`,
        validUntil: null,
      },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function readNotifColumn(
  orgId: string,
  id: string,
  column: 'read_at' | 'snoozed_until',
): Promise<string | null> {
  const res = await getEventStorePool().query<{ value: Date | string | null }>(
    `SELECT ${column} AS value FROM notifications WHERE aggregate_path = $1`,
    [`orgs/${orgId}/notifications/${id}`],
  )
  // `*_at` columns are `timestamptz` (brief 0068 D1): the pg driver returns a
  // `Date`, not the stored ISO string. Normalize to ISO at this raw-read
  // boundary so assertions compare like-for-like (mirrors projector `rowToDoc`).
  const value = res.rows[0]?.value ?? null
  return value == null ? null : new Date(value).toISOString()
}

describe('markNotificationRead (AC-16) — Postgres', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE events, projections, notifications, orgs CASCADE')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('sets read_at and removes from unread fetch', async () => {
    const orgId = uniqueOrgId('read')
    await seedOrg(orgId)
    await seedNotif(orgId, 'n1')

    const before = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10 })
    expect(before.unreadCount).toBe(1)

    const r = await markNotificationRead(orgId, 'n1', 'owner-1')
    expect(r.ok).toBe(true)

    expect(await readNotifColumn(orgId, 'n1', 'read_at')).toBeTruthy()

    const after = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10 })
    expect(after.unreadCount).toBe(0)
  })
})

describe('snoozeNotification (AC-17) — Postgres', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE events, projections, notifications, orgs CASCADE')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('sets snoozed_until future and hides from fetch until it passes', async () => {
    const orgId = uniqueOrgId('snooze')
    await seedOrg(orgId)
    await seedNotif(orgId, 'n1')

    const now = new Date('2026-06-01T12:00:00.000Z')
    const r = await snoozeNotification({
      orgId,
      notificationId: 'n1',
      option: '4h',
      actorUid: 'owner-1',
      tz: TZ,
      now,
    })
    expect(r.ok).toBe(true)

    expect(await readNotifColumn(orgId, 'n1', 'snoozed_until')).toBe('2026-06-01T16:00:00.000Z')

    // Antes do snoozedUntil → oculto
    const hidden = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10, now })
    expect(hidden.unreadCount).toBe(0)

    // Depois do snoozedUntil → reaparece
    const later = new Date('2026-06-01T17:00:00.000Z')
    const back = await fetchUnreadNotificationsForUnit({
      orgId,
      unitId: 'u1',
      limit: 10,
      now: later,
    })
    expect(back.unreadCount).toBe(1)
  })

  it('snooze tomorrow sets 09:00 tz', async () => {
    const orgId = uniqueOrgId('snooze-tomorrow')
    await seedOrg(orgId)
    await seedNotif(orgId, 'n1')

    const now = new Date('2026-06-01T14:00:00.000Z')
    const r = await snoozeNotification({
      orgId,
      notificationId: 'n1',
      option: 'tomorrow',
      actorUid: 'owner-1',
      tz: TZ,
      now,
    })
    expect(r.ok).toBe(true)

    expect(await readNotifColumn(orgId, 'n1', 'snoozed_until')).toBe('2026-06-02T12:00:00.000Z')
  })
})
