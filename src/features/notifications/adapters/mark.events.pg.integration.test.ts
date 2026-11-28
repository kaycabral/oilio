import { NotificationConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { fetchUnreadNotificationsForUnit } from '@/shared/org/notification-read'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { markNotificationRead, snoozeNotification } from './mark'

const TZ = 'America/Sao_Paulo'

function uniqueOrgId(label: string): string {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedOrg(orgId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId],
  )
}

async function seedNotif(orgId: string, id: string, type = 'order_stale'): Promise<void> {
  await Effect.runPromise(
    appendEvent(NotificationConfig, aggregateRef(NotificationConfig, orgId, id), {
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
  const res = await ownerPool().query<{ value: Date | string | null }>(
    `SELECT ${column} AS value FROM notifications WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  )
  const value = res.rows[0]?.value ?? null
  return value == null ? null : new Date(value).toISOString()
}

describe('markNotificationRead (AC-16) — Postgres', () => {
  beforeEach(async () => {
    await ownerPool().query('TRUNCATE events, projections, notifications, orgs CASCADE')
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
    await ownerPool().query('TRUNCATE events, projections, notifications, orgs CASCADE')
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

    const hidden = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10, now })
    expect(hidden.unreadCount).toBe(0)

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
