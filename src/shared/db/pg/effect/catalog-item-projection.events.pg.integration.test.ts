import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import type {
  CatalogItem,
  CatalogProductItem,
  CatalogServiceItem,
} from '@/domain/types/catalog-item'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { PostgresPersistenceLayer, deletePostgresProjection } from './postgres-layer'

const ORG = 'org-cat'
const refOf = (id: string) => aggregateRef(CatalogItemConfig, ORG, id)

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

async function seedOrg(orgId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId],
  )
}

async function seedCategory(orgId: string, categoryId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO categories (org_id, id, last_event_version, name, icon, color, active, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Cat',NULL,NULL,true,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, categoryId],
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

const create = async (item: CatalogItem) => {
  await seedOrg(ORG)
  if (item.categoryId !== null) await seedCategory(ORG, item.categoryId)
  for (const unitId of item.unitIds) await seedUnit(ORG, unitId)
  return Effect.runPromise(
    appendEvent(CatalogItemConfig, refOf(item.id), {
      _tag: 'catalog_item.created',
      actorId: 'test',
      payload: { data: item },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

const update = (id: string, changes: Record<string, unknown>) =>
  Effect.runPromise(
    appendEvent(CatalogItemConfig, refOf(id), {
      _tag: 'catalog_item.updated',
      actorId: 'test',
      payload: { changes },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const replay = (id: string) =>
  Effect.runPromise(
    replayAggregate(CatalogItemConfig, refOf(id)).pipe(Effect.provide(PostgresPersistenceLayer)),
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
  const pool = ownerPool()
  const res = await pool.query<TypedRow>(
    'SELECT * FROM catalog_items WHERE org_id = $1 AND id = $2',
    [ORG, id],
  )
  return res.rows[0]
}

async function genericProjectionCount(id: string): Promise<number> {
  const pool = ownerPool()
  const res = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM projections WHERE org_id = $1 AND id = $2',
    [ORG, id],
  )
  return res.rows[0]?.n ?? 0
}

describe('Postgres typed projection — catalog_items (brief 0058)', () => {
  beforeEach(async () => {
    const pool = ownerPool()
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

    expect(await genericProjectionCount('svc1')).toBe(0)

    const pool = ownerPool()
    const events = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      ['svc1'],
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

    expect(await typedRow('svc-blank')).toBeUndefined()
    const pool = ownerPool()
    const events = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      ['svc-blank'],
    )
    expect(events.rows[0]?.n).toBe(0)
  })

  it('AC-01: the DATABASE refuses a negative price (CHECK)', async () => {
    await expect(create(product('prod-neg', { priceCents: -1 }))).rejects.toThrow()
    expect(await typedRow('prod-neg')).toBeUndefined()
  })

  it('AC-01: the DATABASE refuses the wrong kind-shape (service carrying stock)', async () => {
    const pool = ownerPool()
    await expect(
      pool.query(
        `INSERT INTO catalog_items
           (org_id, id, last_event_version, kind, name, price_cents, price_visibility,
            active, duration_minutes, stock, unit_ids, public_visible, created_at, updated_at)
         VALUES ($1,$2,1,'service','X',100,'visible',true,30,5,'[]'::jsonb,true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [ORG, 'bad'],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-02: a hard-delete drops the typed row (event history preserved)', async () => {
    await create(service('svc-del'))
    expect(await typedRow('svc-del')).toBeDefined()

    await Effect.runPromise(
      appendEvent(CatalogItemConfig, refOf('svc-del'), {
        _tag: 'catalog_item.deleted',
        actorId: 'test',
        payload: {},
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    await deletePostgresProjection(refOf('svc-del'))

    expect(await typedRow('svc-del')).toBeUndefined()
    const pool = ownerPool()
    const events = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      ['svc-del'],
    )
    expect(events.rows[0]?.n).toBe(2)
  })
})
