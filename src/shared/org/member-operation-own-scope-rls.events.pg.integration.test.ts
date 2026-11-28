import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'

const APP_ROLE = 'oilio_prof_app'
const APP_PASSWORD = 'rls_test'

const ORG = 'org-own'
const UNIT = 'unit-own'
const PRO_A = 'pro-a'
const PRO_B = 'pro-b'
const CUSTOMER = 'cust-1'

let appUrl: string

async function seedOrg(): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
}

async function seedUnit(): Promise<void> {
  await ownerPool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','appointment','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, UNIT],
  )
}

async function seedMemberOperation(id: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||('user-'||$2),'user-'||$2,1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
  await ownerPool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,$1||'_'||('user-'||$2),NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedCustomer(): Promise<void> {
  await ownerPool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, CUSTOMER],
  )
}

async function seedService(): Promise<void> {
  await ownerPool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,'svc-1',1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
}

async function seedAppointment(id: string, memberOperationId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO appointments (
       org_id, id, unit_id, last_event_version, member_operation_id, customer_id, service_id,
       customer_user_id, member_operator_user_id, start_at, end_at, status,
       service_price_cents_snapshot, service_duration_minutes_snapshot,
       commission_snapshot, cancellation_policy_snapshot, tracking, created_at, updated_at, member_id)
     VALUES ($1,$2,$3,1,$4,$5,'svc-1','cuser-1','puser-1',
       '2026-06-10T12:00:00Z','2026-06-10T12:30:00Z','scheduled',
       5000,30,NULL,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',
       (SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = $1 AND mo.id = $4))`,
    [ORG, id, UNIT, memberOperationId, CUSTOMER],
  )
}

async function seedBlock(id: string, memberOperationId: string | null): Promise<void> {
  await ownerPool().query(
    `INSERT INTO agenda_blocks (org_id, id, unit_id, last_event_version, kind, member_operation_id, block, created_at, updated_at, member_id)
     VALUES ($1,$2,$3,1,'recurring',$4,'{"reason":"r"}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = $1 AND mo.id = $4))`,
    [ORG, id, UNIT, memberOperationId],
  )
}

async function appClient(memberOperationId = ''): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', ORG])
  await c.query('SELECT set_config($1, $2, false)', ['app.current_unit', UNIT])
  await c.query('SELECT set_config($1, $2, false)', [
    'app.current_member_operation',
    memberOperationId,
  ])
  return c
}

describe('Postgres RLS — memberOperation own-scope on appointments/agenda_blocks (brief 0075)', () => {
  beforeAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON appointments, agenda_blocks TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS own-scope proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    const pool = ownerPool()
    await pool.query('TRUNCATE orgs, units, member_operations, customers, catalog_items CASCADE')
    await seedOrg()
    await seedUnit()
    await seedMemberOperation(PRO_A)
    await seedMemberOperation(PRO_B)
    await seedCustomer()
    await seedService()
  })

  afterAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('a memberOperation reads ONLY their own appointments — never a colleague’s', async () => {
    await seedAppointment('apt-a', PRO_A)
    await seedAppointment('apt-b', PRO_B)

    const a = await appClient(PRO_A)
    try {
      const seen = await a.query<{ id: string }>('SELECT id FROM appointments ORDER BY id')
      expect(seen.rows.map((r) => r.id)).toEqual(['apt-a'])
    } finally {
      await a.end()
    }
  })

  it('the balcão (empty memberOperation GUC) reads every appointment in the unit', async () => {
    await seedAppointment('apt-a', PRO_A)
    await seedAppointment('apt-b', PRO_B)

    const balcao = await appClient('')
    try {
      const seen = await balcao.query<{ id: string }>('SELECT id FROM appointments ORDER BY id')
      expect(seen.rows.map((r) => r.id)).toEqual(['apt-a', 'apt-b'])
    } finally {
      await balcao.end()
    }
  })

  it('a memberOperation CANNOT insert an appointment for another memberOperation (WITH CHECK)', async () => {
    const a = await appClient(PRO_A)
    try {
      await expect(
        a.query(
          `INSERT INTO appointments (
             org_id, id, unit_id, last_event_version, member_operation_id, customer_id, service_id,
             customer_user_id, member_operator_user_id, start_at, end_at, status,
             service_price_cents_snapshot, service_duration_minutes_snapshot,
             commission_snapshot, cancellation_policy_snapshot, tracking, created_at, updated_at, member_id)
           VALUES ($1,'apt-x',$2,1,$3,$4,'svc-1','cuser-1','puser-1',
             '2026-06-10T12:00:00Z','2026-06-10T12:30:00Z','scheduled',
             5000,30,NULL,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',
             $1||'_'||('user-'||$3))`,
          [ORG, UNIT, PRO_B, CUSTOMER],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a memberOperation CANNOT update a colleague’s appointment (zero rows affected — invisible)', async () => {
    await seedAppointment('apt-b', PRO_B)

    const a = await appClient(PRO_A)
    try {
      const res = await a.query(`UPDATE appointments SET status = 'canceled' WHERE id = 'apt-b'`)
      expect(res.rowCount).toBe(0)
    } finally {
      await a.end()
    }
  })

  it('a memberOperation sees their own blocks AND unit-wide (NULL) blocks, but not a colleague’s', async () => {
    await seedBlock('blk-a', PRO_A)
    await seedBlock('blk-b', PRO_B)
    await seedBlock('blk-unit', null)

    const a = await appClient(PRO_A)
    try {
      const seen = await a.query<{ id: string }>('SELECT id FROM agenda_blocks ORDER BY id')
      expect(seen.rows.map((r) => r.id)).toEqual(['blk-a', 'blk-unit'])
    } finally {
      await a.end()
    }
  })
})
