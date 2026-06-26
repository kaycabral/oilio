import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { blockSubjectInOrg } from './block-subject-in-org'

/**
 * Per-org CUSTOMER block against REAL Postgres (brief 0032 / #1096 + #1100,
 * AC-09/AC-11 — the rewrite of the Firestore-emulator `block-subject-in-org.
 * integration.test.ts`). Post-cutover (brief 0062) there is NO `blocked_subjects`
 * marker table: the materialized `archived_at` on the customer shadow IS the fact
 * of record. The block ARCHIVES the subject's customer shadow(s) via
 * `customer.updated { archivedAt }` (event-first) in THIS org only, and runs the
 * erasure cascade first; the global account stays a separate concern.
 *
 * The customer aggregate is event-sourced: the archive emits a real event over
 * the event-store pool (RLS bypassed locally/CI — the policies are proven in the
 * isolation specs) and the reducer projects `archived_at` on the typed
 * `customers` row in the same tx. Preconditions are seeded as typed projection
 * rows via superuser INSERT; each `customer.updated` event reads the seeded
 * projection doc and reprojects. Per-run-unique ids; no global wipe between cases.
 */

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$2,$2,1,'Org','slug-'||$2,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [`orgs/${orgId}`, orgId],
  )
}

// Seeds a customer shadow (the operational projection; PII lives on the global
// user). Returns the shadow id.
async function seedCustomerShadow(orgId: string, userId: string): Promise<string> {
  const id = uniqueId('cust')
  await getEventStorePool().query(
    `INSERT INTO customers (aggregate_path, org_id, id, version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,NULL,NULL,$5,$5)`,
    [`orgs/${orgId}/customers/${id}`, orgId, id, userId, TS],
  )
  return id
}

async function archivedAtOf(orgId: string, customerId: string): Promise<string | null | undefined> {
  const res = await getEventStorePool().query<{ archived_at: Date | string | null }>(
    'SELECT archived_at FROM customers WHERE org_id = $1 AND id = $2',
    [orgId, customerId],
  )
  // `archived_at` is `timestamptz` (brief 0068 D1): the pg driver returns a
  // `Date`. Normalize to ISO so the `toMatch(/^\d{4}-.../)` assertions hold.
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
    // No subscription seeded — cascade reports no active subscription.
    expect(result.hadActiveSubscription).toBe(false)

    // Customer shadow archived (event-first projection set `archived_at`) — the
    // fact of record (no separate marker table post-cutover).
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

    // Org A archived.
    expect(await archivedAtOf(orgA, custA)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Org B fully intact — shadow not archived (the block is per-org).
    expect(await archivedAtOf(orgB, custB)).toBeNull()
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    const result = await blockSubjectInOrg(uniqueId('org'), '')
    expect(result).toEqual({ blocked: false, archivedCustomers: 0, hadActiveSubscription: false })
  })
})
