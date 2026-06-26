// Postgres integration test — #959, brief 0018 Grupo E (re-substrated to
// Postgres by the cutover, #1202).
//
// AC-18/19: fetchUnreadNotificationsForUnit com allowedTypes (derivado do role)
// — count + items respeitam a visibilidade. Receptionist não vê tipos
// financeiros. Live read path (`@/shared/org/notification-read`), typed
// `notifications` projection seeded directly over the superuser pool.

import { allowedNotificationTypesForRole } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { fetchUnreadNotificationsForUnit } from '@/shared/org/notification-read'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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

async function seed(orgId: string, id: string, type: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO notifications (aggregate_path, org_id, id, unit_id, version, type, source, event_key, customer_id, appointment_id, subscription_id, read_at, dispatched_at, valid_until, snoozed_until, payload, dispatch, created_at, updated_at)
     VALUES ($1,$2,$3,'u1',1,$4,'cron',$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,'2026-06-01T10:00:00.000Z','2026-01-01T00:00:00Z')`,
    [`orgs/${orgId}/notifications/${id}`, orgId, id, type, `${id}-key`],
  )
}

describe('fetchUnreadNotificationsForUnit role filter (AC-18/19)', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE notifications, orgs CASCADE')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('receptionist não vê cash_register_open nem payment_failure', async () => {
    const orgId = uniqueOrgId('recep')
    await seedOrg(orgId)
    await seed(orgId, 'birthday', 'birthday')
    await seed(orgId, 'cash', 'cash_register_open')
    await seed(orgId, 'pay', 'payment_failure')
    await seed(orgId, 'order', 'order_stale')

    const allowed = allowedNotificationTypesForRole('receptionist')
    const res = await fetchUnreadNotificationsForUnit({
      orgId,
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
    const orgId = uniqueOrgId('mgr')
    await seedOrg(orgId)
    await seed(orgId, 'birthday', 'birthday')
    await seed(orgId, 'cash', 'cash_register_open')
    await seed(orgId, 'pay', 'payment_failure')

    const allowed = allowedNotificationTypesForRole('manager')
    const res = await fetchUnreadNotificationsForUnit({
      orgId,
      unitId: 'u1',
      limit: 10,
      now: new Date(),
      allowedTypes: allowed,
    })

    expect(res.unreadCount).toBe(3)
  })

  it('sem allowedTypes → sem filtro de role (count total)', async () => {
    const orgId = uniqueOrgId('noflt')
    await seedOrg(orgId)
    await seed(orgId, 'cash', 'cash_register_open')
    const res = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10 })
    expect(res.unreadCount).toBe(1)
  })
})
