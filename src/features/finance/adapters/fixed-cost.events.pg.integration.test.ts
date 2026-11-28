import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const APP_ROLE = 'oilio_fixed_cost_app'
const APP_PASSWORD = 'rls_test'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const UNIT_A1 = 'unit-a1'
const UNIT_A2 = 'unit-a2'

let appUrl: string

async function seedOrg(id: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [id],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId],
  )
}

async function seedFixedCost(orgId: string, id: string, unitId: string): Promise<void> {
  await seedUnit(orgId, unitId)
  await ownerPool().query(
    `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, effective_to, archived_at, created_at, updated_at)
     VALUES ($1,$2,$3,$2,1,'Aluguel','expense_admin',200000,'2026-01-01T00:00:00Z',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId, id, unitId],
  )
}

async function appClient(orgId: string, unitId = ''): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', orgId])
  await c.query('SELECT set_config($1, $2, false)', ['app.current_unit', unitId])
  return c
}

describe('Postgres RLS + CHECK — fixed_costs (brief 0092, Grupo A)', () => {
  beforeAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, units, fixed_costs, fixed_cost_overrides TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await ownerPool().query('TRUNCATE fixed_costs, fixed_cost_overrides, units, orgs CASCADE')
  })

  afterAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('a session scoped to org A reads ZERO fixed costs of org B (read isolation)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    await seedFixedCost(ORG_A, 'a', UNIT_A1)
    await seedFixedCost(ORG_B, 'b', UNIT_A1)

    const a = await appClient(ORG_A)
    try {
      const all = await a.query<{ org_id: string }>('SELECT org_id FROM fixed_costs')
      expect(all.rows).toHaveLength(1)
      expect(all.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await a.end()
    }
  })

  it('a session scoped to org A CANNOT INSERT a fixed cost for org B (42501)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    await seedUnit(ORG_B, UNIT_A1)

    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, created_at, updated_at)
           VALUES ($1,'x',$2,'x',1,'Aluguel','expense_admin',200000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_B, UNIT_A1],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a cross-scope UPDATE of an invisible row affects zero rows (RLS USING)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    await seedFixedCost(ORG_B, 'b', UNIT_A1)

    const a = await appClient(ORG_A)
    try {
      const res = await a.query(`UPDATE fixed_costs SET amount_cents = 999999 WHERE id = 'b'`)
      expect(res.rowCount).toBe(0)
    } finally {
      await a.end()
    }
  })

  it('a session with NO org context (GUC unset) sees zero rows (fail-closed)', async () => {
    await seedOrg(ORG_A)
    await seedFixedCost(ORG_A, 'a', UNIT_A1)

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const visible = await c.query('SELECT org_id FROM fixed_costs')
      expect(visible.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })

  it('a single-unit-locked session does NOT see another unit; org-wide sees all', async () => {
    await seedOrg(ORG_A)
    await seedFixedCost(ORG_A, 'a1', UNIT_A1)
    await seedFixedCost(ORG_A, 'a2', UNIT_A2)

    const locked = await appClient(ORG_A, UNIT_A1)
    try {
      const seen = await locked.query<{ unit_id: string }>('SELECT unit_id FROM fixed_costs')
      expect(seen.rows).toHaveLength(1)
      expect(seen.rows[0]?.unit_id).toBe(UNIT_A1)
    } finally {
      await locked.end()
    }

    const orgWide = await appClient(ORG_A)
    try {
      const seen = await orgWide.query<{ unit_id: string }>('SELECT unit_id FROM fixed_costs')
      expect(seen.rows.map((r) => r.unit_id).sort()).toEqual([UNIT_A1, UNIT_A2])
    } finally {
      await orgWide.end()
    }
  })

  it('rejects a zero/negative amount (23514, AC-05)', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)
    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, created_at, updated_at)
           VALUES ($1,'z',$2,'z',1,'Aluguel','expense_admin',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_A, UNIT_A1],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await a.end()
    }
  })

  it('rejects a blank name (23514, AC-05)', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)
    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, created_at, updated_at)
           VALUES ($1,'n',$2,'n',1,'   ','expense_admin',200000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_A, UNIT_A1],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await a.end()
    }
  })

  it('rejects an incoherent vigência window (effective_from ≥ effective_to) (23514)', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)
    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, effective_to, created_at, updated_at)
           VALUES ($1,'v',$2,'v',1,'Aluguel','expense_admin',200000,'2026-07-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_A, UNIT_A1],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await a.end()
    }
  })

  it('rejects a malformed override month (23514, AC-03)', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)
    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO fixed_cost_overrides (org_id, id, unit_id, series_id, last_event_version, month, amount_cents, created_at, updated_at)
           VALUES ($1,'o',$2,'s',1,'2026/07',200000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_A, UNIT_A1],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await a.end()
    }
  })

  it('enforces one override per (org, series, month) (23505 unique)', async () => {
    await seedOrg(ORG_A)
    await seedUnit(ORG_A, UNIT_A1)
    const a = await appClient(ORG_A)
    try {
      const insert = (id: string) =>
        a.query(
          `INSERT INTO fixed_cost_overrides (org_id, id, unit_id, series_id, last_event_version, month, amount_cents, created_at, updated_at)
           VALUES ($1,$3,$2,'s',1,'2026-07',200000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_A, UNIT_A1, id],
        )
      await insert('o1')
      await expect(insert('o2')).rejects.toMatchObject({ code: '23505' })
    } finally {
      await a.end()
    }
  })
})
