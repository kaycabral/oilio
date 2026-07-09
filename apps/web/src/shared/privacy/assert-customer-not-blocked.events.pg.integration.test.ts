import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { AuthzError } from '@/shared/org/membership'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { assertCustomerIdNotBlocked, assertCustomerNotBlocked } from './assert-customer-not-blocked'

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

async function seedCustomerShadow(
  orgId: string,
  userId: string,
  archived: boolean,
): Promise<string> {
  const id = uniqueId('cust')
  await getEventStorePool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,$3,$4,NULL,$5,$5)`,
    [orgId, id, userId, archived ? TS : null, TS],
  )
  return id
}

describe('assertCustomerNotBlocked (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE customers, orgs CASCADE')
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('rejects a blocked customer (by userId — archived shadow)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    await seedOrg(orgId)
    await seedCustomerShadow(orgId, userId, true)
    await expect(assertCustomerNotBlocked(orgId, userId)).rejects.toBeInstanceOf(AuthzError)
  })

  it('allows a non-blocked customer (by userId — shadow not archived)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    await seedOrg(orgId)
    await seedCustomerShadow(orgId, userId, false)
    await expect(assertCustomerNotBlocked(orgId, userId)).resolves.toBeUndefined()
  })

  it('allows a subject with no customer shadow at all', async () => {
    const orgId = uniqueId('org')
    await seedOrg(orgId)
    await expect(assertCustomerNotBlocked(orgId, uniqueId('user'))).resolves.toBeUndefined()
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    await expect(assertCustomerNotBlocked(uniqueId('org'), '')).resolves.toBeUndefined()
  })

  it('rejects via customerId when the resolved subject is blocked', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    await seedOrg(orgId)
    const customerId = await seedCustomerShadow(orgId, userId, true)
    await expect(assertCustomerIdNotBlocked(orgId, customerId)).rejects.toBeInstanceOf(AuthzError)
  })

  it('allows via customerId when the subject is not blocked', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    await seedOrg(orgId)
    const customerId = await seedCustomerShadow(orgId, userId, false)
    await expect(assertCustomerIdNotBlocked(orgId, customerId)).resolves.toBeUndefined()
  })

  it('is a no-op for a missing customer (caller owns the not-found error)', async () => {
    const orgId = uniqueId('org')
    await seedOrg(orgId)
    await expect(assertCustomerIdNotBlocked(orgId, uniqueId('missing'))).resolves.toBeUndefined()
  })
})
