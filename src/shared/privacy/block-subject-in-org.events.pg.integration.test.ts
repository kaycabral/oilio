import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { blockSubjectInOrg } from './block-subject-in-org'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId],
  )
}

async function seedCustomerShadow(orgId: string, userId: string): Promise<string> {
  const id = uniqueId('cust')
  await getEventStorePool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,$3,NULL,NULL,$4,$4)`,
    [orgId, id, userId, TS],
  )
  return id
}

async function archivedAtOf(orgId: string, customerId: string): Promise<string | null | undefined> {
  const res = await getEventStorePool().query<{ archived_at: Date | string | null }>(
    'SELECT archived_at FROM customers WHERE org_id = $1 AND id = $2',
    [orgId, customerId],
  )
  const value = res.rows[0]?.archived_at
  return value == null ? value : new Date(value).toISOString()
}

describe('blockSubjectInOrg (customer-scoped, Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE events, projections, customers, orgs CASCADE')
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('archives the customer shadow in that org (the archived_at IS the block); global account untouched', async () => {
    const userId = uniqueId('subject')
    const orgA = uniqueId('org')
    await seedOrg(orgA)
    const customerId = await seedCustomerShadow(orgA, userId)

    const result = await blockSubjectInOrg(orgA, userId)

    expect(result.blocked).toBe(true)
    expect(result.archivedCustomers).toBe(1)
    expect(result.hadActiveSubscription).toBe(false)

    expect(await archivedAtOf(orgA, customerId)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('does not leak into a second org where the subject is also a customer', async () => {
    const userId = uniqueId('subject')
    const orgA = uniqueId('org')
    const orgB = uniqueId('org')
    await seedOrg(orgA)
    await seedOrg(orgB)
    const custA = await seedCustomerShadow(orgA, userId)
    const custB = await seedCustomerShadow(orgB, userId)

    await blockSubjectInOrg(orgA, userId)

    expect(await archivedAtOf(orgA, custA)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await archivedAtOf(orgB, custB)).toBeNull()
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    const result = await blockSubjectInOrg(uniqueId('org'), '')
    expect(result).toEqual({ blocked: false, archivedCustomers: 0, hadActiveSubscription: false })
  })
})
