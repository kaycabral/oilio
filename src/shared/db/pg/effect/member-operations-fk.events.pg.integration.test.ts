import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'

const FK_VIOLATION = '23503'
const ORG = 'memops-org'
const USER = 'memops-user'

function pool() {
  return ownerPool()
}

function memberId(org: string, user: string): string {
  return `${org}_${user}`
}

async function seedOrg(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
}

async function seedMembership(user = USER, role = 'member_operator'): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1, $1||'_'||$2, $2, 1, $3, 'active', '2026-01-01T00:00:00Z', '{}'::jsonb, '2026-01-01T00:00:00Z')`,
    [ORG, user, role],
  )
}

async function seedMemberOperation(id: string, user = USER, member?: string): Promise<void> {
  await pool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,$3,$4,NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, user, member ?? memberId(ORG, user)],
  )
}

const UNIT = 'memops-unit'
const SERVICE = 'memops-svc'
const CUSTOMER = 'memops-cust'

async function seedUnit(): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, UNIT],
  )
}

async function seedService(): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, SERVICE],
  )
}

async function seedCustomer(): Promise<void> {
  await pool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, CUSTOMER],
  )
}

async function seedAppointment(id: string, proId: string): Promise<void> {
  await pool().query(
    `INSERT INTO appointments (org_id, id, unit_id, last_event_version, member_operation_id, customer_id, service_id, customer_user_id, member_operator_user_id, start_at, end_at, status, service_price_cents_snapshot, service_duration_minutes_snapshot, commission_snapshot, cancellation_policy_snapshot, tracking, created_at, updated_at, member_id)
     VALUES ($1,$2,$3,1,$4,$5,$6,'user-'||$5,$7,'2026-01-02T10:00:00Z','2026-01-02T10:30:00Z','scheduled',5000,30,NULL,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = $1 AND mo.id = $4))`,
    [ORG, id, UNIT, proId, CUSTOMER, SERVICE, USER],
  )
}

async function seedAgendaBlock(id: string, proId: string): Promise<void> {
  await pool().query(
    `INSERT INTO agenda_blocks (org_id, id, unit_id, last_event_version, kind, member_operation_id, block, created_at, updated_at, member_id)
     VALUES ($1,$2,$3,1,'one_off',$4,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = $1 AND mo.id = $4))`,
    [ORG, id, UNIT, proId],
  )
}

describe('operational profile hangs off the membership (brief 0076 AC-02/AC-05)', () => {
  beforeEach(async () => {
    await pool().query(
      'TRUNCATE events, projections, appointments, agenda_blocks, member_operations, memberships, catalog_items, customers, units, orgs CASCADE',
    )
    await seedOrg()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-02 — refuses an orphan profile with no matching membership (23503)', async () => {
    await expect(seedMemberOperation('pro-orphan', USER, `${ORG}_ghost`)).rejects.toMatchObject({
      code: FK_VIOLATION,
    })
  })

  it('AC-02 — accepts a profile backed by a real membership', async () => {
    await seedMembership()
    await expect(seedMemberOperation('pro-1')).resolves.toBeUndefined()
    const { rows } = await pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM member_operations WHERE org_id = $1 AND id = 'pro-1'`,
      [ORG],
    )
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('AC-05 — removing a membership with no history cascades the profile away', async () => {
    await seedMembership()
    await seedMemberOperation('pro-1')
    const before = await pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM member_operations WHERE org_id = $1`,
      [ORG],
    )
    expect(Number(before.rows[0]?.n)).toBe(1)

    await pool().query(`DELETE FROM memberships WHERE org_id = $1 AND id = $2`, [
      ORG,
      memberId(ORG, USER),
    ])

    const after = await pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM member_operations WHERE org_id = $1`,
      [ORG],
    )
    expect(Number(after.rows[0]?.n)).toBe(0)
  })

  it('AC-04/AC-05 — a membership WITH an appointment cannot be removed (history restrict)', async () => {
    await seedMembership()
    await seedMemberOperation('pro-1')
    await seedUnit()
    await seedService()
    await seedCustomer()
    await seedAppointment('appt-1', 'pro-1')

    await expect(
      pool().query(`DELETE FROM memberships WHERE org_id = $1 AND id = $2`, [
        ORG,
        memberId(ORG, USER),
      ]),
    ).rejects.toMatchObject({ code: FK_VIOLATION })

    const survivors = await pool().query<{ n: string }>(
      `SELECT
         (SELECT count(*) FROM memberships WHERE org_id = $1) +
         (SELECT count(*) FROM member_operations WHERE org_id = $1) AS n`,
      [ORG],
    )
    expect(Number(survivors.rows[0]?.n)).toBe(2)
  })

  it('AC-05 — a membership whose profile carries an agenda block still cascades (block ref nulled)', async () => {
    await seedMembership()
    await seedMemberOperation('pro-1')
    await seedUnit()
    await seedAgendaBlock('block-1', 'pro-1')

    await expect(
      pool().query(`DELETE FROM memberships WHERE org_id = $1 AND id = $2`, [
        ORG,
        memberId(ORG, USER),
      ]),
    ).resolves.toBeDefined()

    const { rows } = await pool().query<{ member_operation_id: string | null }>(
      `SELECT member_operation_id FROM agenda_blocks WHERE org_id = $1 AND id = 'block-1'`,
      [ORG],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.member_operation_id).toBeNull()
  })
})
