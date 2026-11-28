import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { fetchUnreadNotificationsForUnit } from '@/shared/org/notification-read'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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

type SeedOpts = {
  unitId: string
  type?: string
  createdAt: string
  readAt?: string | null
  dispatchedAt?: string | null
}

async function seed(orgId: string, id: string, opts: SeedOpts): Promise<void> {
  await ownerPool().query(
    `INSERT INTO notifications (org_id, id, unit_id, last_event_version, type, source, event_key, customer_id, appointment_id, subscription_id, read_at, dispatched_at, valid_until, snoozed_until, payload, dispatch, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,'cron',$5,NULL,NULL,NULL,$6,$7,NULL,NULL,'{}'::jsonb,NULL,$8,'2026-01-01T00:00:00Z')`,
    [
      orgId,
      id,
      opts.unitId,
      opts.type ?? 'birthday',
      `${id}-key`,
      opts.readAt ?? null,
      opts.dispatchedAt ?? null,
      opts.createdAt,
    ],
  )
}

describe('fetchUnreadNotificationsForUnit (Postgres integration)', () => {
  beforeEach(async () => {
    await ownerPool().query('TRUNCATE notifications, orgs CASCADE')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('counts unread + returns top N for the unit', async () => {
    const orgId = uniqueOrgId('topn')
    await seedOrg(orgId)
    await seed(orgId, 'n1', { unitId: 'u1', createdAt: '2026-06-01T10:00:00.000Z' })
    await seed(orgId, 'n2', { unitId: 'u1', createdAt: '2026-06-01T11:00:00.000Z' })
    await seed(orgId, 'n3', { unitId: 'u1', createdAt: '2026-06-01T12:00:00.000Z' })

    const result = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 2 })

    expect(result.unreadCount).toBe(3)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]!.id).toBe('n3')
    expect(result.items[1]!.id).toBe('n2')
  })

  it('excludes read and dispatched notifications', async () => {
    const orgId = uniqueOrgId('readstate')
    await seedOrg(orgId)
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

    const result = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10 })

    expect(result.unreadCount).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.id).toBe('unread')
  })

  it('isolates by unit — does not leak other units', async () => {
    const orgId = uniqueOrgId('isolation')
    await seedOrg(orgId)
    await seed(orgId, 'u1-a', { unitId: 'u1', createdAt: '2026-06-01T10:00:00.000Z' })
    await seed(orgId, 'u2-a', { unitId: 'u2', createdAt: '2026-06-01T11:00:00.000Z' })
    await seed(orgId, 'u2-b', { unitId: 'u2', createdAt: '2026-06-01T12:00:00.000Z' })

    const result = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10 })

    expect(result.unreadCount).toBe(1)
    expect(result.items.every((n) => n.unitId === 'u1')).toBe(true)
  })

  it('empty state: 0 unread → count 0 + empty items', async () => {
    const orgId = uniqueOrgId('empty')
    await seedOrg(orgId)
    const result = await fetchUnreadNotificationsForUnit({ orgId, unitId: 'u1', limit: 10 })

    expect(result.unreadCount).toBe(0)
    expect(result.items).toHaveLength(0)
  })
})
