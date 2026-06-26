import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import { appendEvent, replayAggregate } from '@/domain/effect'
import type {
  CatalogItem,
  CatalogProductItem,
  CatalogServiceItem,
} from '@/domain/types/catalog-item'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { PostgresPersistenceLayer, deletePostgresProjection } from './postgres-layer'

// Typed projection routing for the `catalog_item` context against REAL Postgres
// (brief 0058, AC-01 + AC-03). Proves the per-context typed-projection mechanism:
// a `catalog_item` projection lands in the TYPED `catalog_items` table (NOT the
// generic `projections` JSONB store) in the SAME transaction as its event; the
// DATABASE refuses an invariant violation (kind / blank name / negative price /
// bad visibility / wrong kind-shape); replay reconstructs the typed state; and a
// hard-delete drops the typed row while the generic store is untouched.
// globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
// database (docker locally, services:postgres in CI).

const ORG = 'org-cat'
const pathOf = (id: string) => `orgs/${ORG}/catalog_items/${id}`

function service(id: string, overrides: Partial<CatalogServiceItem> = {}): CatalogServiceItem {
  return {
    id,
    orgId: ORG,
    kind: 'service',
    name: 'Corte',
    categoryId: 'cat-1',
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
    unitIds: ['u1'],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: true,
    durationMinutes: 30,
    requiredResources: ['cadeira-1'],
    archivedAt: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

function product(id: string, overrides: Partial<CatalogProductItem> = {}): CatalogProductItem {
  return {
    id,
    orgId: ORG,
    kind: 'product',
    name: 'Pomada',
    categoryId: 'cat-2',
    priceCents: 3000,
    commission: null,
    unitIds: ['u1'],
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    sku: 'POM-001',
    stock: 10,
    gtin14: null,
    archivedAt: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

// Parent rows the new D2/0068 catalog_items FKs require: `org_id → orgs` and the
// (org_id, category_id) → categories composite. Seeded over the superuser pool
// with ON CONFLICT so repeated ids are idempotent.
async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ('orgs/'||$1,$1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId],
  )
}

async function seedCategory(orgId: string, categoryId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO categories (aggregate_path, org_id, id, version, name, icon, color, active, archived_at, created_at, updated_at)
     VALUES ('orgs/'||$1||'/categories/'||$2,$1,$2,1,'Cat',NULL,NULL,true,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, categoryId],
  )
}

// The `catalog_item_units` join FK (brief 0068 D3) requires each `unitIds` ref to
// exist in `units(org_id, id)`; the projector mirrors the array in the same tx,
// so the parent units must be seeded first.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ('orgs/'||$1||'/units/'||$2,$1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, unitId],
  )
}

const create = async (item: CatalogItem) => {
  await seedOrg(ORG)
  if (item.categoryId !== null) await seedCategory(ORG, item.categoryId)
  for (const unitId of item.unitIds) await seedUnit(ORG, unitId)
  return Effect.runPromise(
    appendEvent(CatalogItemConfig, pathOf(item.id), {
      _tag: 'catalog_item.created',
      actorId: 'test',
      payload: { data: item },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

const update = (id: string, changes: Record<string, unknown>) =>
  Effect.runPromise(
    appendEvent(CatalogItemConfig, pathOf(id), {
      _tag: 'catalog_item.updated',
      actorId: 'test',
      payload: { changes },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const replay = (id: string) =>
  Effect.runPromise(
    replayAggregate(CatalogItemConfig, pathOf(id)).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

type TypedRow = {
  kind: string
  name: string
  org_id: string
  price_cents: string | number
  duration_minutes: string | number | null
  sku: string | null
  stock: string | number | null
}

async function typedRow(id: string): Promise<TypedRow | undefined> {
  const pool = getEventStorePool()
  const res = await pool.query<TypedRow>('SELECT * FROM catalog_items WHERE aggregate_path = $1', [
    pathOf(id),
  ])
  return res.rows[0]
}

async function genericProjectionCount(id: string): Promise<number> {
  const pool = getEventStorePool()
  const res = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM projections WHERE aggregate_path = $1',
    [pathOf(id)],
  )
  return res.rows[0]?.n ?? 0
}

describe('Postgres typed projection — catalog_items (brief 0058)', () => {
  beforeEach(async () => {
    const pool = getEventStorePool()
    // CASCADE: `catalog_items` is now referenced by `appointments.service_id`
    // (brief 0068 D2), so a plain TRUNCATE is refused even with zero referencing
    // rows.
    await pool.query('TRUNCATE events, projections, catalog_items CASCADE')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-03: a catalog_item projection routes to the TYPED table, not the generic store', async () => {
    await create(service('svc1'))

    const row = await typedRow('svc1')
    if (!row) throw new Error('expected typed row')
    expect(row.kind).toBe('service')
    expect(row.name).toBe('Corte')
    expect(Number(row.price_cents)).toBe(5000)
    expect(row.org_id).toBe(ORG)
    expect(Number(row.duration_minutes)).toBe(30)

    // The generic JSONB store was NOT used for this context.
    expect(await genericProjectionCount('svc1')).toBe(0)

    // The event still landed in the append-only log (same tx).
    const pool = getEventStorePool()
    const events = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      [pathOf('svc1')],
    )
    expect(events.rows[0]?.n).toBe(1)
  })

  it('AC-01/AC-02: create → update projects the typed row; replay reconstructs identical state', async () => {
    await create(product('prod1'))
    await update('prod1', { stock: 8, priceCents: 2500 })

    const row = await typedRow('prod1')
    if (!row) throw new Error('expected typed row')
    expect(row.kind).toBe('product')
    expect(row.sku).toBe('POM-001')
    expect(Number(row.stock)).toBe(8)
    expect(Number(row.price_cents)).toBe(2500)
    expect(row.duration_minutes).toBeNull()

    const replayed = await replay('prod1')
    expect(replayed.priceCents).toBe(2500)
    expect(replayed._version).toBe(2)
    if (replayed.kind !== 'product') throw new Error('expected product')
    expect(replayed.stock).toBe(8)
  })

  it('AC-01: the DATABASE refuses a blank name (CHECK), rolling back event + projection', async () => {
    await expect(create(service('svc-blank', { name: '   ' }))).rejects.toThrow()

    // Atomic: neither the typed row nor the event survived the rollback.
    expect(await typedRow('svc-blank')).toBeUndefined()
    const pool = getEventStorePool()
    const events = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      [pathOf('svc-blank')],
    )
    expect(events.rows[0]?.n).toBe(0)
  })

  it('AC-01: the DATABASE refuses a negative price (CHECK)', async () => {
    await expect(create(product('prod-neg', { priceCents: -1 }))).rejects.toThrow()
    expect(await typedRow('prod-neg')).toBeUndefined()
  })

  it('AC-01: the DATABASE refuses the wrong kind-shape (service carrying stock)', async () => {
    // A service that somehow carries a product-only column violates the
    // conditional kind-shape CHECK — refused by the DB, not the app.
    const pool = getEventStorePool()
    await expect(
      pool.query(
        `INSERT INTO catalog_items
           (aggregate_path, org_id, id, version, kind, name, price_cents, price_visibility,
            active, duration_minutes, stock, unit_ids, public_visible, created_at, updated_at)
         VALUES ($1,$2,$3,1,'service','X',100,'visible',true,30,5,'[]'::jsonb,true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [pathOf('bad'), ORG, 'bad'],
      ),
      // 23514 = Postgres check_violation.
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-02: a hard-delete drops the typed row (event history preserved)', async () => {
    await create(service('svc-del'))
    expect(await typedRow('svc-del')).toBeDefined()

    // The `*.deleted` event is appended (history), the projection write is
    // skipped by the event store, and the backend-aware delete drops the row.
    await Effect.runPromise(
      appendEvent(CatalogItemConfig, pathOf('svc-del'), {
        _tag: 'catalog_item.deleted',
        actorId: 'test',
        payload: {},
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    await deletePostgresProjection(pathOf('svc-del'))

    expect(await typedRow('svc-del')).toBeUndefined()
    const pool = getEventStorePool()
    const events = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      [pathOf('svc-del')],
    )
    // created + deleted both kept in the append-only log.
    expect(events.rows[0]?.n).toBe(2)
  })
})
