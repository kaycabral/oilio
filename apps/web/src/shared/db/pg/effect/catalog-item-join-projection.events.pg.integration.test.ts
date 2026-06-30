import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import type { CatalogServiceItem } from '@/domain/types/catalog-item'
import { Effect } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { PostgresPersistenceLayer } from './postgres-layer'

/**
 * Join-table projection proof for `catalog-item ↔ unit` against REAL Postgres
 * (brief 0068 D3, #1225). Proves: the projector mirrors the reduced state's
 * `unitIds` array into the `catalog_item_units` join table in the SAME tx as the
 * event; a shrunk array leaves no orphan rows (delete-then-insert idempotency);
 * REPLAY reconstructs the reduced state the rows derive from; the FK refuses a
 * dangling unit ref; cascade-on-delete; and RLS isolates the rows per org.
 */

const ORG = 'org-ciu'
const UNIT_A = 'unit-a'
const UNIT_B = 'unit-b'
const CAT = 'cat-1'
const ITEM = 'item-1'

const APP_ROLE = 'oilio_ciu_app'
const APP_PASSWORD = 'ciu_test'
let appUrl: string

const refOf = (id: string) => aggregateRef(CatalogItemConfig, ORG, id)

function item(overrides: Partial<CatalogServiceItem> = {}): CatalogServiceItem {
  return {
    id: ITEM,
    orgId: ORG,
    kind: 'service',
    name: 'Corte',
    categoryId: CAT,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
    unitIds: [UNIT_A, UNIT_B],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: true,
    durationMinutes: 30,
    requiredResources: [],
    archivedAt: null,
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

async function seedParents(): Promise<void> {
  await seedOrg()
  await seedUnit(UNIT_A)
  await seedUnit(UNIT_B)
  await seedCategory(CAT)
}

const create = (it: CatalogServiceItem) =>
  Effect.runPromise(
    appendEvent(CatalogItemConfig, refOf(it.id), {
      _tag: 'catalog_item.created',
      actorId: 'test',
      payload: { data: it },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const update = (changes: Partial<CatalogServiceItem>) =>
  Effect.runPromise(
    appendEvent(CatalogItemConfig, refOf(ITEM), {
      _tag: 'catalog_item.updated',
      actorId: 'test',
      payload: { changes },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const replay = () =>
  Effect.runPromise(
    replayAggregate(CatalogItemConfig, refOf(ITEM)).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

async function unitIds(): Promise<string[]> {
  const res = await pool().query<{ unit_id: string }>(
    'SELECT unit_id FROM catalog_item_units WHERE org_id = $1 AND catalog_item_id = $2 ORDER BY unit_id',
    [ORG, ITEM],
  )
  return res.rows.map((r) => r.unit_id)
}

describe('Postgres join projection — catalog-item ↔ unit (brief 0068 D3)', () => {
  beforeAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await p.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await p.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_item_units TO ${APP_ROLE}`)
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the join-projection proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await pool().query(
      'TRUNCATE events, projections, catalog_item_units, catalog_items, categories, units, orgs CASCADE',
    )
    await seedParents()
  })

  afterAll(async () => {
    const p = pool()
    await p.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await p.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('mirrors the unitIds array into the join table in the same tx', async () => {
    await create(item())
    expect(await unitIds()).toEqual([UNIT_A, UNIT_B])
  })

  it('delete-then-insert: a shrunk array leaves no orphan rows', async () => {
    await create(item())
    await update({ unitIds: [UNIT_A] })
    expect(await unitIds()).toEqual([UNIT_A])
  })

  it('an empty unitIds array is refused at the event boundary (#1283), writing nothing', async () => {
    // A catalog item with no unit is a phantom (#1283): the `catalog_item.created`
    // event schema filters on a non-empty `unitIds` (`UnitScopedCatalogItem`), so
    // the payload fails to decode at `appendEvent` — fail-fast at the OUTER
    // boundary, before the DB CHECK (`catalog_items_unit_ids_nonempty`, proven by
    // the identity-catalog-nonempty suite). The event never persists, so the join
    // table stays empty.
    await expect(create(item({ unitIds: [] }))).rejects.toThrow()
    expect(await unitIds()).toEqual([])
    const events = await pool().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM events WHERE org_id = $1 AND aggregate_id = $2',
      [ORG, ITEM],
    )
    expect(events.rows[0]?.n).toBe('0')
  })

  it('replay reconstructs the reduced state the join rows derive from', async () => {
    await create(item())
    await update({ unitIds: [UNIT_B] })
    const state = await replay()
    expect(state.unitIds).toEqual([UNIT_B])
    expect(await unitIds()).toEqual([UNIT_B])
  })

  it('the DB refuses a join row pointing at a missing unit (composite FK)', async () => {
    await create(item())
    await expect(
      pool().query(
        'INSERT INTO catalog_item_units (org_id, catalog_item_id, unit_id) VALUES ($1, $2, $3)',
        [ORG, ITEM, 'ghost-unit'],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('deleting the catalog item cascades its join rows away', async () => {
    await create(item())
    expect(await unitIds()).toHaveLength(2)
    await pool().query('DELETE FROM catalog_items WHERE org_id = $1 AND id = $2', [ORG, ITEM])
    expect(await unitIds()).toEqual([])
  })

  it('RLS: a session scoped to another org sees ZERO join rows', async () => {
    await create(item())
    const other = new Client({ connectionString: appUrl })
    await other.connect()
    try {
      await other.query('SELECT set_config($1, $2, false)', ['app.current_org', 'org-other'])
      await other.query('SELECT set_config($1, $2, false)', ['app.current_unit', ''])
      const res = await other.query('SELECT * FROM catalog_item_units')
      expect(res.rows).toHaveLength(0)
    } finally {
      await other.end()
    }
  })
})
