import { MemberOperationConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import type { StoredMemberOperation } from '@/domain/types/member-operation'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { Effect } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { PostgresPersistenceLayer } from './postgres-layer'

const ORG = 'org-pj'
const UNIT_A = 'unit-a'
const UNIT_B = 'unit-b'
const SVC_A = 'svc-a'
const SVC_B = 'svc-b'
const PRO = 'pro-1'

const APP_ROLE = 'oilio_pj_app'
const APP_PASSWORD = 'pj_test'
let appUrl: string

const refOf = (id: string) => aggregateRef(MemberOperationConfig, ORG, id)

function memberOperation(overrides: Partial<StoredMemberOperation> = {}): StoredMemberOperation {
  return {
    id: PRO,
    orgId: ORG,
    userId: 'user-pro-1',
    defaultCommission: null,
    unitIds: [UNIT_A, UNIT_B],
    catalogServiceIds: [SVC_A, SVC_B],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function pool() {
  return ownerPool()
}

async function seedOrg(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
}

async function seedUnit(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedService(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedMembership(): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_user-pro-1','user-pro-1',1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
}

async function seedParents(): Promise<void> {
  await seedOrg()
  await seedMembership()
  await seedUnit(UNIT_A)
  await seedUnit(UNIT_B)
  await seedService(SVC_A)
  await seedService(SVC_B)
}

const create = (pro: StoredMemberOperation) =>
  Effect.runPromise(
    appendEvent(MemberOperationConfig, refOf(pro.id), {
      _tag: 'member_operation.created',
      actorId: 'test',
      payload: { data: pro },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const update = (changes: Partial<StoredMemberOperation>) =>
  Effect.runPromise(
    appendEvent(MemberOperationConfig, refOf(PRO), {
      _tag: 'member_operation.updated',
      actorId: 'test',
      payload: { changes },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const replay = () =>
  Effect.runPromise(
    replayAggregate(MemberOperationConfig, refOf(PRO)).pipe(
      Effect.provide(PostgresPersistenceLayer),
    ),
  )

async function unitIds(): Promise<string[]> {
  const res = await pool().query<{ unit_id: string }>(
    'SELECT unit_id FROM member_operation_units WHERE org_id = $1 AND member_operation_id = $2 ORDER BY unit_id',
    [ORG, PRO],
  )
  return res.rows.map((r) => r.unit_id)
}

async function serviceJoinIds(): Promise<string[]> {
  const res = await pool().query<{ service_id: string }>(
    'SELECT service_id FROM member_operation_services WHERE org_id = $1 AND member_operation_id = $2 ORDER BY service_id',
    [ORG, PRO],
  )
  return res.rows.map((r) => r.service_id)
}

describe('Postgres join projection — memberOperation ↔ unit/service (brief 0068 D3)', () => {
  beforeAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await p.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await p.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON member_operation_units, member_operation_services TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the join-projection proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await pool().query(
      'TRUNCATE events, projections, member_operation_units, member_operation_services, member_operations, memberships, catalog_items, units, orgs CASCADE',
    )
    await seedParents()
  })

  afterAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('mirrors the arrays into the join tables in the same tx', async () => {
    await create(memberOperation())
    expect(await unitIds()).toEqual([UNIT_A, UNIT_B])
    expect(await serviceJoinIds()).toEqual([SVC_A, SVC_B])
  })

  it('delete-then-insert: a shrunk array leaves no orphan rows', async () => {
    await create(memberOperation())
    await update({ unitIds: [UNIT_A], catalogServiceIds: [SVC_B] })
    expect(await unitIds()).toEqual([UNIT_A])
    expect(await serviceJoinIds()).toEqual([SVC_B])
  })

  it('replay reconstructs the reduced state the join rows derive from', async () => {
    await create(memberOperation())
    await update({ unitIds: [UNIT_B] })
    const state = await replay()
    expect(state.unitIds).toEqual([UNIT_B])
    expect(state.catalogServiceIds).toEqual([SVC_A, SVC_B])
    expect(await unitIds()).toEqual([UNIT_B])
    expect(await serviceJoinIds()).toEqual([SVC_A, SVC_B])
  })

  it('the DB refuses a join row pointing at a missing unit (composite FK)', async () => {
    await create(memberOperation())
    await expect(
      pool().query(
        'INSERT INTO member_operation_units (org_id, member_operation_id, unit_id) VALUES ($1, $2, $3)',
        [ORG, PRO, 'ghost-unit'],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('deleting the memberOperation cascades its join rows away', async () => {
    await create(memberOperation())
    expect(await unitIds()).toHaveLength(2)
    await pool().query('DELETE FROM member_operations WHERE org_id = $1 AND id = $2', [ORG, PRO])
    expect(await unitIds()).toEqual([])
    expect(await serviceJoinIds()).toEqual([])
  })

  it('RLS: a session scoped to another org sees ZERO join rows', async () => {
    await create(memberOperation())
    const other = new Client({ connectionString: appUrl })
    await other.connect()
    try {
      await other.query('SELECT set_config($1, $2, false)', ['app.current_org', 'org-other'])
      await other.query('SELECT set_config($1, $2, false)', ['app.current_unit', ''])
      const res = await other.query('SELECT * FROM member_operation_units')
      expect(res.rows).toHaveLength(0)
    } finally {
      await other.end()
    }
  })
})
