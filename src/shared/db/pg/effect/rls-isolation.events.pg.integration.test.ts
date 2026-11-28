import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'

const APP_ROLE = 'oilio_rls_app'
const APP_PASSWORD = 'rls_test'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const UNIT_A1 = 'unit-a1'
const UNIT_A2 = 'unit-a2'

let appUrl: string

async function seedOrg(id: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [id],
  )
}

async function seedUnit(orgId: string, id: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'U','slug-'||$2,'America/Sao_Paulo','fixed','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId, id],
  )
}

async function appClient(orgId: string, unitId = ''): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', orgId])
  await c.query('SELECT set_config($1, $2, false)', ['app.current_unit', unitId])
  return c
}

describe('Postgres RLS isolation — identity (brief 0059, AC-03)', () => {
  beforeAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, units, memberships, catalog_items TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS isolation proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await ownerPool().query('TRUNCATE units, memberships, orgs, catalog_items CASCADE')
  })

  afterAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('a session scoped to org A reads ZERO rows of org B (read isolation)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const a = await appClient(ORG_A)
    try {
      const all = await a.query<{ org_id: string }>('SELECT org_id FROM orgs')
      expect(all.rows).toHaveLength(1)
      expect(all.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await a.end()
    }
  })

  it('a session scoped to org A CANNOT write a row for org B (write isolation)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
           VALUES ($1,'u',1,'U','u','America/Sao_Paulo','fixed','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_B],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a write with NO org context (GUC unset) sees/touches zero rows (fail-closed)', async () => {
    await seedOrg(ORG_A)

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const visible = await c.query('SELECT org_id FROM orgs')
      expect(visible.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })

  it('a single-unit-locked session does NOT see another unit; org-wide sees all', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)
    await seedUnit(ORG_A, UNIT_A2)

    const locked = await appClient(ORG_A, UNIT_A1)
    try {
      const seen = await locked.query<{ id: string }>('SELECT id FROM units ORDER BY id')
      expect(seen.rows.map((r) => r.id)).toEqual([UNIT_A1])
    } finally {
      await locked.end()
    }

    const orgWide = await appClient(ORG_A)
    try {
      const seen = await orgWide.query<{ id: string }>('SELECT id FROM units ORDER BY id')
      expect(seen.rows.map((r) => r.id)).toEqual([UNIT_A1, UNIT_A2])
    } finally {
      await orgWide.end()
    }
  })

  it('a DELETE without org context removes ZERO rows; scoped to the org it removes the row (delete path)', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)

    const noCtx = new Client({ connectionString: appUrl })
    await noCtx.connect()
    try {
      const res = await noCtx.query('DELETE FROM units WHERE org_id = $1 AND id = $2', [
        ORG_A,
        UNIT_A1,
      ])
      expect(res.rowCount).toBe(0)
    } finally {
      await noCtx.end()
    }
    expect((await ownerPool().query('SELECT 1 FROM units')).rowCount).toBe(1)

    const a = await appClient(ORG_A)
    try {
      const res = await a.query('DELETE FROM units WHERE org_id = $1 AND id = $2', [ORG_A, UNIT_A1])
      expect(res.rowCount).toBe(1)
    } finally {
      await a.end()
    }
  })

  it('catalog_items (feature B) is under RLS too — org A does not see org B items', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    const pool = ownerPool()
    for (const [org, id] of [
      [ORG_A, 'svc-a'],
      [ORG_B, 'svc-b'],
    ] as const) {
      await pool.query(
        `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, price_cents, price_visibility, active, duration_minutes, unit_ids, public_visible, created_at, updated_at)
         VALUES ($1,$2,1,'service','S',100,'visible',true,30,'["unit-seed"]'::jsonb,true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [org, id],
      )
    }

    const a = await appClient(ORG_A)
    try {
      const seen = await a.query<{ org_id: string }>('SELECT org_id FROM catalog_items')
      expect(seen.rows).toHaveLength(1)
      expect(seen.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await a.end()
    }
  })
})
