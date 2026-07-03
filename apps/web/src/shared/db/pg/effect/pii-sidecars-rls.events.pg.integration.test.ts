import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * RLS isolation proof for the four deletable PII sidecars (migration feature F —
 * cutover, brief 0062, AC-03): `invites_pii`, `member_operations_pii`, `units_pii`,
 * `unit_tax_identity`. Each is org-only — the policy filters
 * `org_id = current_setting('app.current_org')` on USING (read) and WITH CHECK
 * (write) — so an org can never read or write another org's PII rows, and a
 * connection with NO org context is fail-closed (zero rows).
 *
 * Mirrors `config-rls-isolation.events.pg.integration.test.ts`: the ephemeral
 * Postgres connects as superuser (which bypasses RLS), so every isolation
 * assertion runs through a NON-superuser role (`oilio_rls_app`, no BYPASSRLS).
 * Seeding happens over the superuser pool so the fixtures exist regardless of
 * policy. Each table carries different columns, so `seedRow` / `writeForeign`
 * switch on the table to satisfy each row's NOT NULL columns.
 */

const APP_ROLE = 'oilio_rls_app'
const APP_PASSWORD = 'rls_test'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

let appUrl: string

const PII_SIDECARS = [
  'invites_pii',
  'member_operations_pii',
  'units_pii',
  'unit_tax_identity',
] as const
type PiiSidecar = (typeof PII_SIDECARS)[number]

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [id],
  )
}

// Seed one minimal valid row per sidecar (over the superuser pool, bypassing RLS).
async function seedRow(table: PiiSidecar, orgId: string, id: string): Promise<void> {
  const pool = getEventStorePool()
  switch (table) {
    case 'invites_pii':
      await pool.query(
        `INSERT INTO invites_pii (org_id, id, mobile)
         VALUES ($1,$2,'5511900000000')`,
        [orgId, id],
      )
      return
    case 'member_operations_pii':
      await pool.query(
        `INSERT INTO member_operations_pii (org_id, id, tax_identity)
         VALUES ($1,$2,'{"kind":"individual","taxId":"12345678900"}'::jsonb)`,
        [orgId, id],
      )
      return
    case 'units_pii':
      await pool.query(
        `INSERT INTO units_pii (org_id, id, mobile, email)
         VALUES ($1,$2,'5511999990000',NULL)`,
        [orgId, id],
      )
      return
    case 'unit_tax_identity':
      await pool.query(
        `INSERT INTO unit_tax_identity (org_id, id, tax_identity)
         VALUES ($1,$2,'{"kind":"company","taxId":"40148980000199","legalName":"ACME"}'::jsonb)`,
        [orgId, id],
      )
      return
  }
}

// A write of a FOREIGN-org row, attempted through an org-A session (must be
// refused by WITH CHECK). Same column shapes as `seedRow`, but for org B.
function foreignInsert(
  table: PiiSidecar,
  orgId: string,
  id: string,
): { sql: string; params: unknown[] } {
  switch (table) {
    case 'invites_pii':
      return {
        sql: `INSERT INTO invites_pii (org_id, id, mobile) VALUES ($1,$2,'5511900000000')`,
        params: [orgId, id],
      }
    case 'member_operations_pii':
      return {
        sql: `INSERT INTO member_operations_pii (org_id, id, tax_identity) VALUES ($1,$2,NULL)`,
        params: [orgId, id],
      }
    case 'units_pii':
      return {
        sql: `INSERT INTO units_pii (org_id, id, mobile, email) VALUES ($1,$2,'5511000000000',NULL)`,
        params: [orgId, id],
      }
    case 'unit_tax_identity':
      return {
        sql: `INSERT INTO unit_tax_identity (org_id, id, tax_identity) VALUES ($1,$2,NULL)`,
        params: [orgId, id],
      }
  }
}

// A fresh connection AS the non-superuser app role, with `app.current_org` set.
async function appClient(orgId: string): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', orgId])
  return c
}

describe('Postgres RLS isolation — PII sidecars (brief 0062, AC-03)', () => {
  beforeAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, invites_pii, member_operations_pii, units_pii, unit_tax_identity TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS isolation proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE invites_pii, member_operations_pii, units_pii, unit_tax_identity, orgs CASCADE',
    )
  })

  afterAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  // ── Cross-org READ refusal — proven for ALL 4 sidecars ─────────────────────
  for (const table of PII_SIDECARS) {
    it(`${table}: a session scoped to org A reads ZERO rows of org B (read isolation)`, async () => {
      await seedOrg(ORG_A)
      await seedOrg(ORG_B)
      await seedRow(table, ORG_A, 'a')
      await seedRow(table, ORG_B, 'b')

      const a = await appClient(ORG_A)
      try {
        const all = await a.query<{ org_id: string }>(`SELECT org_id FROM ${table}`)
        expect(all.rows).toHaveLength(1)
        expect(all.rows[0]?.org_id).toBe(ORG_A)
      } finally {
        await a.end()
      }
    })
  }

  // ── Cross-org WRITE refusal — proven for ALL 4 sidecars ────────────────────
  for (const table of PII_SIDECARS) {
    it(`${table}: a session scoped to org A CANNOT INSERT a row for org B (WITH CHECK)`, async () => {
      await seedOrg(ORG_A)
      await seedOrg(ORG_B)

      const a = await appClient(ORG_A)
      const { sql, params } = foreignInsert(table, ORG_B, 'b')
      try {
        // 42501 = insufficient_privilege (RLS WITH CHECK violation)
        await expect(a.query(sql, params)).rejects.toMatchObject({ code: '42501' })
      } finally {
        await a.end()
      }
    })
  }

  // ── Fail-closed: no GUC → zero rows — proven for ALL 4 sidecars ─────────────
  for (const table of PII_SIDECARS) {
    it(`${table}: a session with NO org context (GUC unset) sees zero rows (fail-closed)`, async () => {
      await seedOrg(ORG_A)
      await seedRow(table, ORG_A, 'a')

      const c = new Client({ connectionString: appUrl })
      await c.connect()
      try {
        const visible = await c.query(`SELECT org_id FROM ${table}`)
        expect(visible.rows).toHaveLength(0)
      } finally {
        await c.end()
      }
    })
  }
})
