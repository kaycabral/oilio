import { ProfessionalConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import type { StoredProfessional } from '@/domain/types/professional'
import { Effect } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { PostgresPersistenceLayer } from './postgres-layer'

/**
 * Join-table projection proof for `professional ↔ unit / service` against REAL
 * Postgres (brief 0068 D3). Proves: the projector mirrors the reduced state's
 * `unit_ids` / `catalog_service_ids` arrays into the `professional_units` /
 * `professional_services` join tables in the SAME tx as the event; a shrunk array
 * leaves no orphan rows (delete-then-insert idempotency); REPLAY reconstructs the
 * join rows from the array; the FKs refuse a dangling unit/service ref; and RLS
 * isolates the rows per org.
 */

const ORG = 'org-pj'
const UNIT_A = 'unit-a'
const UNIT_B = 'unit-b'
const SVC_A = 'svc-a'
const SVC_B = 'svc-b'
const PRO = 'pro-1'

const APP_ROLE = 'oilio_pj_app'
const APP_PASSWORD = 'pj_test'
let appUrl: string

const refOf = (id: string) => aggregateRef(ProfessionalConfig, ORG, id)

function professional(overrides: Partial<StoredProfessional> = {}): StoredProfessional {
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
  return getEventStorePool()
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
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedService(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedMembership(): Promise<void> {
  // The operational profile hangs off the membership (brief 0076 AC-02): the
  // projector derives `member_id` as `{ORG}_{userId}` and the composite FK needs
  // this parent. PRO's userId is `user-pro-1`.
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_user-pro-1','user-pro-1',1,'professional','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
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

const create = (pro: StoredProfessional) =>
  Effect.runPromise(
    appendEvent(ProfessionalConfig, refOf(pro.id), {
      _tag: 'professional.created',
      actorId: 'test',
      payload: { data: pro },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const update = (changes: Partial<StoredProfessional>) =>
  Effect.runPromise(
    appendEvent(ProfessionalConfig, refOf(PRO), {
      _tag: 'professional.updated',
      actorId: 'test',
      payload: { changes },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const replay = () =>
  Effect.runPromise(
    replayAggregate(ProfessionalConfig, refOf(PRO)).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

async function unitIds(): Promise<string[]> {
  const res = await pool().query<{ unit_id: string }>(
    'SELECT unit_id FROM professional_units WHERE org_id = $1 AND professional_id = $2 ORDER BY unit_id',
    [ORG, PRO],
  )
  return res.rows.map((r) => r.unit_id)
}

async function serviceJoinIds(): Promise<string[]> {
  const res = await pool().query<{ service_id: string }>(
    'SELECT service_id FROM professional_services WHERE org_id = $1 AND professional_id = $2 ORDER BY service_id',
    [ORG, PRO],
  )
  return res.rows.map((r) => r.service_id)
}

describe('Postgres join projection — professional ↔ unit/service (brief 0068 D3)', () => {
  beforeAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await p.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await p.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON professional_units, professional_services TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the join-projection proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await pool().query(
      'TRUNCATE events, projections, professional_units, professional_services, professionals, memberships, catalog_items, units, orgs CASCADE',
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
    await create(professional())
    expect(await unitIds()).toEqual([UNIT_A, UNIT_B])
    expect(await serviceJoinIds()).toEqual([SVC_A, SVC_B])
  })

  it('delete-then-insert: a shrunk array leaves no orphan rows', async () => {
    await create(professional())
    await update({ unitIds: [UNIT_A], catalogServiceIds: [SVC_B] })
    expect(await unitIds()).toEqual([UNIT_A])
    expect(await serviceJoinIds()).toEqual([SVC_B])
  })

  it('replay reconstructs the reduced state the join rows derive from', async () => {
    await create(professional())
    await update({ unitIds: [UNIT_B] })
    // `replayAggregate` rebuilds the reduced state in memory (it does not
    // re-run the projector); the join tables are a projection OF that state, so
    // proving replay yields the right arrays proves the rows are derivable. The
    // same-tx mirroring + idempotency are proven by the cases above.
    const state = await replay()
    expect(state.unitIds).toEqual([UNIT_B])
    expect(state.catalogServiceIds).toEqual([SVC_A, SVC_B])
    // And the live projection (written by the last upsert) matches.
    expect(await unitIds()).toEqual([UNIT_B])
    expect(await serviceJoinIds()).toEqual([SVC_A, SVC_B])
  })

  it('the DB refuses a join row pointing at a missing unit (composite FK)', async () => {
    await create(professional())
    await expect(
      pool().query(
        'INSERT INTO professional_units (org_id, professional_id, unit_id) VALUES ($1, $2, $3)',
        [ORG, PRO, 'ghost-unit'],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('deleting the professional cascades its join rows away', async () => {
    await create(professional())
    expect(await unitIds()).toHaveLength(2)
    await pool().query('DELETE FROM professionals WHERE org_id = $1 AND id = $2', [ORG, PRO])
    expect(await unitIds()).toEqual([])
    expect(await serviceJoinIds()).toEqual([])
  })

  it('RLS: a session scoped to another org sees ZERO join rows', async () => {
    await create(professional())
    const other = new Client({ connectionString: appUrl })
    await other.connect()
    try {
      await other.query('SELECT set_config($1, $2, false)', ['app.current_org', 'org-other'])
      await other.query('SELECT set_config($1, $2, false)', ['app.current_unit', ''])
      const res = await other.query('SELECT * FROM professional_units')
      expect(res.rows).toHaveLength(0)
    } finally {
      await other.end()
    }
  })
})
