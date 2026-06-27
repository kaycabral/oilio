import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * RLS isolation + CHECK constraint proof for `org_billing` (brief 0071, AC-02) —
 * the Assinatura Oilio table. Mirrors `config-rls-isolation.events.pg.integration`:
 * the ephemeral Postgres connects as superuser (bypasses RLS), so isolation runs
 * through a NON-superuser role (`oilio_billing_rls_app`, NOBYPASSRLS — the prod
 * runtime shape). Invariants are proven by the DB, not mocked.
 *
 * Also proves the non-RLS `org_billing_stripe_index`: the webhook lookup table is
 * INTENTIONALLY readable without an org GUC (it's how the session-less webhook
 * resolves stripe_customer_id → org_id).
 */

const APP_ROLE = 'oilio_billing_rls_app'
const APP_PASSWORD = 'rls_test'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

let appUrl: string

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [id],
  )
}

async function seedBilling(orgId: string, tier: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, cancel_at_period_end, created_at, updated_at)
     VALUES ($1,$1,1,$2,'active',1,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId, tier],
  )
}

async function appClient(orgId: string): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', orgId])
  await c.query('SELECT set_config($1, $2, false)', ['app.current_unit', ''])
  return c
}

describe('Postgres RLS + CHECK — org_billing (brief 0071, AC-02)', () => {
  beforeAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, org_billing, org_billing_stripe_index TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS isolation proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE org_billing_stripe_index, org_billing, orgs CASCADE')
  })

  afterAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('a session scoped to org A reads ZERO billing rows of org B (read isolation)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    await seedBilling(ORG_A, 'pro')
    await seedBilling(ORG_B, 'advanced')

    const a = await appClient(ORG_A)
    try {
      const all = await a.query<{ org_id: string }>('SELECT org_id FROM org_billing')
      expect(all.rows).toHaveLength(1)
      expect(all.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await a.end()
    }
  })

  it('a session scoped to org A CANNOT INSERT billing for org B (WITH CHECK)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, cancel_at_period_end, created_at, updated_at)
           VALUES ($1,$1,1,'pro','active',1,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_B],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a session with NO org context (GUC unset) sees zero billing rows (fail-closed)', async () => {
    await seedOrg(ORG_A)
    await seedBilling(ORG_A, 'pro')

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const visible = await c.query('SELECT org_id FROM org_billing')
      expect(visible.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })

  // ── CHECK constraints — proven by the DB ────────────────────────────────────
  it('rejects an invalid tier (CHECK org_billing_tier_check)', async () => {
    await seedOrg(ORG_A)
    await expect(
      getEventStorePool().query(
        `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, cancel_at_period_end, created_at, updated_at)
         VALUES ($1,$1,1,'enterprise','active',1,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG_A],
      ),
      // 23514 = check_violation
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects an invalid status (CHECK org_billing_status_check)', async () => {
    await seedOrg(ORG_A)
    await expect(
      getEventStorePool().query(
        `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, cancel_at_period_end, created_at, updated_at)
         VALUES ($1,$1,1,'pro','frozen',1,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG_A],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a negative unit_quantity (CHECK org_billing_unit_quantity_nonneg)', async () => {
    await seedOrg(ORG_A)
    await expect(
      getEventStorePool().query(
        `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, cancel_at_period_end, created_at, updated_at)
         VALUES ($1,$1,1,'pro','active',-1,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG_A],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  // ── partial-UNIQUE on stripe ids ────────────────────────────────────────────
  it('rejects two orgs sharing the same stripe_subscription_id (partial UNIQUE)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    const pool = getEventStorePool()
    await pool.query(
      `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, stripe_subscription_id, cancel_at_period_end, created_at, updated_at)
       VALUES ($1,$1,1,'pro','active',1,'sub_dup',false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      [ORG_A],
    )
    await expect(
      pool.query(
        `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, unit_quantity, stripe_subscription_id, cancel_at_period_end, created_at, updated_at)
         VALUES ($1,$1,1,'pro','active',1,'sub_dup',false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG_B],
      ),
      // 23505 = unique_violation
    ).rejects.toMatchObject({ code: '23505' })
  })

  // ── stripe index is NON-RLS by design (webhook lookup) ──────────────────────
  it('org_billing_stripe_index is readable WITHOUT an org GUC (session-less webhook lookup)', async () => {
    await seedOrg(ORG_A)
    await getEventStorePool().query(
      `INSERT INTO org_billing_stripe_index (stripe_customer_id, org_id) VALUES ('cus_x', $1)`,
      [ORG_A],
    )

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const found = await c.query<{ org_id: string }>(
        `SELECT org_id FROM org_billing_stripe_index WHERE stripe_customer_id = 'cus_x'`,
      )
      expect(found.rows).toHaveLength(1)
      expect(found.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await c.end()
    }
  })
})
