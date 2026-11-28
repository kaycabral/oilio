import { SubscriptionPlanConfig } from '@/domain/aggregates/subscription-plan/config'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import type { SubscriptionPlan } from '@/domain/types/subscription-plan'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { Effect } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { PostgresPersistenceLayer } from './postgres-layer'

const ORG = 'org-spj'
const ITEM_A = 'item-a'
const ITEM_B = 'item-b'
const CAT_A = 'cat-a'
const CAT_B = 'cat-b'
const UNIT_A = 'unit-a'
const UNIT_B = 'unit-b'
const PLAN = 'plan-1'

const APP_ROLE = 'oilio_spj_app'
const APP_PASSWORD = 'spj_test'
let appUrl: string

const refOf = (id: string) => aggregateRef(SubscriptionPlanConfig, ORG, id)

function plan(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: PLAN,
    orgId: ORG,
    name: 'Plano Mensal',
    description: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: [ITEM_A, ITEM_B],
    includedCategoryIds: [CAT_A, CAT_B],
    usageLimit: { kind: 'count', quantity: 4 },
    unitAllowlist: [UNIT_A, UNIT_B],
    active: true,
    archivedAt: null,
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

async function seedCategory(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO categories (org_id, id, last_event_version, name, icon, color, active, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Cat',NULL,NULL,true,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedItem(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
}

async function seedParents(): Promise<void> {
  await seedOrg()
  await seedUnit(UNIT_A)
  await seedUnit(UNIT_B)
  await seedCategory(CAT_A)
  await seedCategory(CAT_B)
  await seedItem(ITEM_A)
  await seedItem(ITEM_B)
}

const create = (p: SubscriptionPlan) =>
  Effect.runPromise(
    appendEvent(SubscriptionPlanConfig, refOf(p.id), {
      _tag: 'subscription_plan.created',
      actorId: 'test',
      payload: { data: p },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const update = (changes: Partial<SubscriptionPlan>) =>
  Effect.runPromise(
    appendEvent(SubscriptionPlanConfig, refOf(PLAN), {
      _tag: 'subscription_plan.updated',
      actorId: 'test',
      payload: { changes },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const replay = () =>
  Effect.runPromise(
    replayAggregate(SubscriptionPlanConfig, refOf(PLAN)).pipe(
      Effect.provide(PostgresPersistenceLayer),
    ),
  )

async function selectIds(table: string, column: string): Promise<string[]> {
  const res = await pool().query<{ v: string }>(
    `SELECT ${column} AS v FROM ${table} WHERE org_id = $1 AND plan_id = $2 ORDER BY ${column}`,
    [ORG, PLAN],
  )
  return res.rows.map((r) => r.v)
}

const itemIds = () => selectIds('plan_included_items', 'item_id')
const categoryIds = () => selectIds('plan_included_categories', 'category_id')
const allowlistUnitIds = () => selectIds('plan_unit_allowlist', 'unit_id')

describe('Postgres join projection — subscription-plan ↔ item/category/allowlist (brief 0068 D3)', () => {
  beforeAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await p.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await p.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON plan_included_items, plan_included_categories, plan_unit_allowlist TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the join-projection proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await pool().query(
      'TRUNCATE events, projections, plan_included_items, plan_included_categories, plan_unit_allowlist, subscription_plans, catalog_items, categories, units, orgs CASCADE',
    )
    await seedParents()
  })

  afterAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('mirrors the arrays into the three join tables in the same tx', async () => {
    await create(plan())
    expect(await itemIds()).toEqual([ITEM_A, ITEM_B])
    expect(await categoryIds()).toEqual([CAT_A, CAT_B])
    expect(await allowlistUnitIds()).toEqual([UNIT_A, UNIT_B])
  })

  it('a null unitAllowlist writes ZERO allowlist rows (no restriction)', async () => {
    await create(plan({ unitAllowlist: null }))
    expect(await itemIds()).toEqual([ITEM_A, ITEM_B])
    expect(await allowlistUnitIds()).toEqual([])
  })

  it('an absent (undefined) unitAllowlist writes ZERO allowlist rows', async () => {
    const { unitAllowlist: _omit, ...rest } = plan()
    await create(rest)
    expect(await allowlistUnitIds()).toEqual([])
  })

  it('delete-then-insert: shrunk arrays leave no orphan rows', async () => {
    await create(plan())
    await update({
      includedItemIds: [ITEM_A],
      includedCategoryIds: [CAT_B],
      unitAllowlist: [UNIT_A],
    })
    expect(await itemIds()).toEqual([ITEM_A])
    expect(await categoryIds()).toEqual([CAT_B])
    expect(await allowlistUnitIds()).toEqual([UNIT_A])
  })

  it('clearing the allowlist to null on update drops all allowlist rows', async () => {
    await create(plan())
    expect(await allowlistUnitIds()).toEqual([UNIT_A, UNIT_B])
    await update({ unitAllowlist: null })
    expect(await allowlistUnitIds()).toEqual([])
  })

  it('replay reconstructs the reduced state the join rows derive from', async () => {
    await create(plan())
    await update({ includedItemIds: [ITEM_B] })
    const state = await replay()
    expect(state.includedItemIds).toEqual([ITEM_B])
    expect(state.includedCategoryIds).toEqual([CAT_A, CAT_B])
    expect(await itemIds()).toEqual([ITEM_B])
    expect(await categoryIds()).toEqual([CAT_A, CAT_B])
  })

  it('the DB refuses a join row pointing at a missing item (composite FK)', async () => {
    await create(plan())
    await expect(
      pool().query(
        'INSERT INTO plan_included_items (org_id, plan_id, item_id) VALUES ($1, $2, $3)',
        [ORG, PLAN, 'ghost-item'],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('the DB refuses a join row pointing at a missing category (composite FK)', async () => {
    await create(plan())
    await expect(
      pool().query(
        'INSERT INTO plan_included_categories (org_id, plan_id, category_id) VALUES ($1, $2, $3)',
        [ORG, PLAN, 'ghost-cat'],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('deleting the plan cascades its join rows away', async () => {
    await create(plan())
    expect(await itemIds()).toHaveLength(2)
    await pool().query('DELETE FROM subscription_plans WHERE org_id = $1 AND id = $2', [ORG, PLAN])
    expect(await itemIds()).toEqual([])
    expect(await categoryIds()).toEqual([])
    expect(await allowlistUnitIds()).toEqual([])
  })

  it('RLS: a session scoped to another org sees ZERO join rows', async () => {
    await create(plan())
    const other = new Client({ connectionString: appUrl })
    await other.connect()
    try {
      await other.query('SELECT set_config($1, $2, false)', ['app.current_org', 'org-other'])
      await other.query('SELECT set_config($1, $2, false)', ['app.current_unit', ''])
      const res = await other.query('SELECT * FROM plan_included_items')
      expect(res.rows).toHaveLength(0)
    } finally {
      await other.end()
    }
  })
})
