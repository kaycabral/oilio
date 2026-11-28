import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'

const APP_ROLE = 'oilio_rls_app'
const APP_PASSWORD = 'rls_test'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const UNIT_A1 = 'unit-a1'
const UNIT_A2 = 'unit-a2'

let appUrl: string

const ORG_ONLY_TABLES = [
  'member_operations',
  'customers',
  'invites',
  'categories',
  'subscription_plans',
] as const
const UNIT_SCOPED_TABLES = ['agenda_blocks', 'goals', 'notifications'] as const

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

async function seedRow(table: string, orgId: string, id: string, unitId: string): Promise<void> {
  const pool = ownerPool()
  switch (table) {
    case 'member_operations':
      await pool.query(
        `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
         VALUES ($1,$1||'_'||('user-'||$2),'user-'||$2,1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
         ON CONFLICT (org_id, id) DO NOTHING`,
        [orgId, id],
      )
      await pool.query(
        `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
         VALUES ($1,$2,1,'user-'||$2,$1||'_'||('user-'||$2),NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id],
      )
      return
    case 'customers':
      await pool.query(
        `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
         VALUES ($1,$2,1,'user-'||$2,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id],
      )
      return
    case 'invites':
      await pool.query(
        `INSERT INTO invites (org_id, id, last_event_version, role, token_hash, expires_at, status, invited_by, accepted_by_uid, accepted_at, created_at, updated_at)
         VALUES ($1,$2,1,'member_operator','hash','2026-01-01T00:00:00Z','pending','owner',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id],
      )
      return
    case 'categories':
      await pool.query(
        `INSERT INTO categories (org_id, id, last_event_version, name, icon, color, active, archived_at, created_at, updated_at)
         VALUES ($1,$2,1,'Cat',NULL,NULL,true,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id],
      )
      return
    case 'subscription_plans':
      await pool.query(
        `INSERT INTO subscription_plans (org_id, id, last_event_version, name, description, price_cents, billing_cycle, active, archived_at, usage_limit_kind, usage_limit, included_item_ids, included_category_ids, unit_allowlist, allowed_time_scope, booking_limits, created_at, updated_at)
         VALUES ($1,$2,1,'Plan',NULL,1000,'monthly',true,NULL,'unlimited','{"kind":"unlimited"}'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id],
      )
      return
    case 'agenda_blocks':
      await seedUnit(orgId, unitId)
      await pool.query(
        `INSERT INTO agenda_blocks (org_id, id, unit_id, last_event_version, kind, member_operation_id, block, created_at, updated_at)
         VALUES ($1,$2,$3,1,'recurring',NULL,'{"reason":"r"}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id, unitId],
      )
      return
    case 'goals':
      await seedUnit(orgId, unitId)
      await pool.query(
        `INSERT INTO goals (org_id, id, unit_id, last_event_version, period, type, target_cents, created_at, updated_at)
         VALUES ($1,$2,$3,1,'2026-06','profit',100000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id, unitId],
      )
      return
    case 'notifications':
      await seedUnit(orgId, unitId)
      await pool.query(
        `INSERT INTO notifications (org_id, id, unit_id, last_event_version, type, source, event_key, customer_id, appointment_id, subscription_id, read_at, dispatched_at, valid_until, snoozed_until, payload, dispatch, created_at, updated_at)
         VALUES ($1,$2,$3,1,'birthday','cron','ek-'||$2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [orgId, id, unitId],
      )
      return
    default:
      throw new Error(`unknown table ${table}`)
  }
}

async function appClient(orgId: string, unitId = ''): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', orgId])
  await c.query('SELECT set_config($1, $2, false)', ['app.current_unit', unitId])
  return c
}

describe('Postgres RLS isolation — config (brief 0060, AC-02)', () => {
  beforeAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, member_operations, customers, invites, categories, subscription_plans, agenda_blocks, goals, notifications TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS isolation proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await ownerPool().query(
      'TRUNCATE member_operations, customers, invites, categories, subscription_plans, agenda_blocks, goals, notifications, units, orgs CASCADE',
    )
  })

  afterAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  for (const table of [...ORG_ONLY_TABLES, ...UNIT_SCOPED_TABLES]) {
    it(`${table}: a session scoped to org A reads ZERO rows of org B (read isolation)`, async () => {
      await seedOrg(ORG_A)
      await seedOrg(ORG_B)
      await seedRow(table, ORG_A, 'a', UNIT_A1)
      await seedRow(table, ORG_B, 'b', UNIT_A1)

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

  it('a session scoped to org A CANNOT INSERT a category for org B (WITH CHECK)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO categories (org_id, id, last_event_version, name, active, created_at, updated_at)
           VALUES ($1,'c',1,'C',true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_B],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a session scoped to org A CANNOT INSERT a goal for org B (WITH CHECK)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO goals (org_id, id, unit_id, last_event_version, period, type, target_cents, created_at, updated_at)
           VALUES ($1,'g',$2,1,'2026-06','profit',100000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
          [ORG_B, UNIT_A1],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a session with NO org context (GUC unset) sees zero rows (fail-closed)', async () => {
    await seedOrg(ORG_A)
    await seedRow('member_operations', ORG_A, 'a', UNIT_A1)

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const visible = await c.query('SELECT org_id FROM member_operations')
      expect(visible.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })

  for (const table of UNIT_SCOPED_TABLES) {
    it(`${table}: a single-unit-locked session does NOT see another unit; org-wide sees all`, async () => {
      await seedOrg(ORG_A)
      await seedRow(table, ORG_A, 'a1', UNIT_A1)
      await seedRow(table, ORG_A, 'a2', UNIT_A2)

      const locked = await appClient(ORG_A, UNIT_A1)
      try {
        const seen = await locked.query<{ unit_id: string }>(`SELECT unit_id FROM ${table}`)
        expect(seen.rows).toHaveLength(1)
        expect(seen.rows[0]?.unit_id).toBe(UNIT_A1)
      } finally {
        await locked.end()
      }

      const orgWide = await appClient(ORG_A)
      try {
        const seen = await orgWide.query<{ unit_id: string }>(`SELECT unit_id FROM ${table}`)
        expect(seen.rows.map((r) => r.unit_id).sort()).toEqual([UNIT_A1, UNIT_A2])
      } finally {
        await orgWide.end()
      }
    })
  }
})
