import type { PoolClient } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from './pool'
import { ownerPool } from './test/owner-pool'

const ORG_A = 'runtime-org-a'
const ORG_B = 'runtime-org-b'

const ORG_SCOPED_WITHOUT_RLS = [
  'client_funnel_events',
  'events',
  'member_funnel_events',
  'org_billing_stripe_index',
  'pii_events',
  'projections',
  'public_org_directory',
].sort()

async function seedOrg(id: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [id],
  )
}

async function seedEvent(orgId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope, occurred_at)
     VALUES ('order', $2, 1, $1, '{}'::jsonb, '2026-05-01T12:00:00Z')`,
    [orgId, `orgs/${orgId}/orders/o1`],
  )
}

async function asRuntime<T>(orgId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getEventStorePool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
    await client.query("SELECT set_config('app.current_unit', '', true)")
    return await run(client)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

async function rejectsAsRuntime(sql: string): Promise<void> {
  await expect(asRuntime(ORG_A, (c) => c.query(sql))).rejects.toMatchObject({ code: '42501' })
}

describe('runtime role (oilio_app): least privilege, bound by RLS (#80)', () => {
  beforeEach(async () => {
    await ownerPool().query('TRUNCATE events, orgs CASCADE')
  })

  afterAll(async () => {
    await ownerPool().query('TRUNCATE events, orgs CASCADE')
    await closeEventStoreDb()
  })

  it('the app pool connects as oilio_app: no superuser, no BYPASSRLS, owns nothing', async () => {
    const pool = getEventStorePool()
    const role = await pool.query<{
      current_user: string
      rolsuper: boolean
      rolbypassrls: boolean
    }>('SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')
    expect(role.rows).toEqual([{ current_user: 'oilio_app', rolsuper: false, rolbypassrls: false }])

    const owned = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE pg_get_userbyid(c.relowner) = current_user AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
    )
    expect(owned.rows).toEqual([])
  })

  it('every org-scoped table enables and forces RLS, except the documented exceptions', async () => {
    const res = await ownerPool().query<{ table: string; rls: boolean; forced: boolean }>(
      `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)`,
    )
    const unprotected = res.rows
      .filter((row) => !row.rls || !row.forced)
      .map((row) => row.table)
      .sort()
    expect(unprotected).toEqual(ORG_SCOPED_WITHOUT_RLS)
  })

  it('scoped to org A, reads zero rows of org B; without a GUC, reads none', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const seen = await asRuntime(ORG_A, (c) =>
      c.query<{ org_id: string }>('SELECT org_id FROM orgs'),
    )
    expect(seen.rows.map((r) => r.org_id)).toEqual([ORG_A])

    const unscoped = await getEventStorePool().query('SELECT org_id FROM orgs')
    expect(unscoped.rows).toEqual([])
  })

  it('cannot update or delete another org through RLS (zero rows touched)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const touched = await asRuntime(ORG_A, async (c) => {
      const updated = await c.query("UPDATE orgs SET name = 'x' WHERE org_id = $1", [ORG_B])
      const deleted = await c.query('DELETE FROM orgs WHERE org_id = $1', [ORG_B])
      return [updated.rowCount, deleted.rowCount]
    })
    expect(touched).toEqual([0, 0])
  })

  it('cannot switch RLS off for its session', async () => {
    await seedOrg(ORG_B)
    await expect(
      asRuntime(ORG_A, async (c) => {
        await c.query('SET LOCAL row_security = off')
        return c.query('SELECT org_id FROM orgs')
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('appends to the event log but never rewrites or erases it', async () => {
    await seedEvent(ORG_A)
    const appended = await asRuntime(ORG_A, (c) =>
      c.query(
        `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope, occurred_at)
         VALUES ('order', 'orgs/runtime-org-a/orders/o1', 2, $1, '{}'::jsonb, '2026-05-01T12:00:00Z')`,
        [ORG_A],
      ),
    )
    expect(appended.rowCount).toBe(1)

    await rejectsAsRuntime("UPDATE events SET org_id = 'x'")
    await rejectsAsRuntime('DELETE FROM events')
    await rejectsAsRuntime('DELETE FROM pii_events')
    await rejectsAsRuntime('DELETE FROM product_events')
    await rejectsAsRuntime('TRUNCATE events')
  })

  it('cannot touch the schema, the migration journal or other roles', async () => {
    await rejectsAsRuntime('TRUNCATE orgs')
    await rejectsAsRuntime('ALTER TABLE orgs DISABLE ROW LEVEL SECURITY')
    await rejectsAsRuntime('ALTER TABLE orgs NO FORCE ROW LEVEL SECURITY')
    await rejectsAsRuntime('DROP POLICY orgs_org_isolation ON orgs')
    await rejectsAsRuntime('CREATE TABLE public.runtime_probe (id int)')
    await rejectsAsRuntime('CREATE SCHEMA runtime_probe')
    await rejectsAsRuntime('SELECT * FROM drizzle.__drizzle_migrations')
    await rejectsAsRuntime('SELECT * FROM pg_authid')
    await rejectsAsRuntime('SET ROLE postgres')
    await rejectsAsRuntime('CREATE ROLE runtime_probe')
  })
})
