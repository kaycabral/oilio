import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import { appendEvent } from '@/domain/effect'
import type { CatalogProductItem, CatalogServiceItem } from '@/domain/types/catalog-item'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  countActiveCatalogItemsInCategory,
  countCatalogItemsInCategory,
  getCatalogItemById,
  listCatalogItemIds,
  listCatalogItems,
} from './catalog-item-read'

// Catalog-item READS against REAL Postgres (brief 0058, AC-02 — the
// list/filter/get half of the CRUD cycle). Drives the read adapter so it reads
// the typed `catalog_items` projection: list ordered by name, active-only
// filter, get-by-id, id-only,
// and the category FK count. Seeds via the real event-store append (the same
// path the actions use), so the rows are projected by the typed projector.

const ORG = 'org-read'
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
    requiredResources: [],
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
// (org_id, category_id) → categories composite (set null on delete). Seeded over
// the superuser pool with ON CONFLICT so repeated category ids are idempotent.
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

const create = async (item: CatalogServiceItem | CatalogProductItem) => {
  await seedOrg(ORG)
  if (item.categoryId !== null) await seedCategory(ORG, item.categoryId)
  // The `catalog_item_units` join FK (brief 0068 D3) requires each `unitIds` ref
  // to exist in `units(org_id, id)`; the projector mirrors the array in the same
  // tx, so seed the parent units first.
  for (const unitId of item.unitIds) await seedUnit(ORG, unitId)
  return Effect.runPromise(
    appendEvent(CatalogItemConfig, pathOf(item.id), {
      _tag: 'catalog_item.created',
      actorId: 'test',
      payload: { data: item },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

// Parent units the `catalog_item_units` join (brief 0068 D3) references.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ('orgs/'||$1||'/units/'||$2,$1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, unitId],
  )
}

describe('Catalog-item reads — Postgres (brief 0058)', () => {
  beforeEach(async () => {
    // CASCADE: `catalog_items` is referenced by `appointments.service_id`
    // (D2/0068), so a bare TRUNCATE is refused even with zero referencing rows.
    await getEventStorePool().query(
      'TRUNCATE events, projections, catalog_items, categories, orgs CASCADE',
    )
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-02: listCatalogItems returns the org items ordered by name', async () => {
    await create(service('a', { name: 'Zinco' }))
    await create(product('b', { name: 'Alfa' }))

    const items = await listCatalogItems(ORG)
    expect(items.map((i) => i.name)).toEqual(['Alfa', 'Zinco'])
  })

  it('AC-02: activeOnly excludes archived and inactive items', async () => {
    await create(service('keep'))
    await create(service('inactive', { active: false }))
    await create(service('archived', { archivedAt: '2026-06-02T00:00:00.000Z' }))

    const active = await listCatalogItems(ORG, { activeOnly: true })
    expect(active.map((i) => i.id)).toEqual(['keep'])
  })

  it('AC-02: getCatalogItemById round-trips price/commission/name faithfully', async () => {
    await create(service('svc', { name: 'Barba', priceCents: 4200 }))

    const item = await getCatalogItemById(ORG, 'svc')
    expect(item).not.toBeNull()
    expect(item?.name).toBe('Barba')
    expect(item?.priceCents).toBe(4200)
    expect(item?.commission).toEqual({ kind: 'percentage', value: 50 })
    expect(await getCatalogItemById(ORG, 'missing')).toBeNull()
  })

  it('AC-02: listCatalogItemIds returns every item id for FK checks', async () => {
    await create(service('s1'))
    await create(product('p1'))

    const ids = await listCatalogItemIds(ORG)
    expect(new Set(ids)).toEqual(new Set(['s1', 'p1']))
  })

  it('AC-02: countActiveCatalogItemsInCategory counts non-archived in a category', async () => {
    await create(service('c1', { categoryId: 'cat-x' }))
    await create(service('c2', { categoryId: 'cat-x' }))
    await create(service('c3', { categoryId: 'cat-x', archivedAt: '2026-06-02T00:00:00.000Z' }))
    await create(service('c4', { categoryId: 'cat-other' }))

    expect(await countActiveCatalogItemsInCategory(ORG, 'cat-x')).toBe(2)
    expect(await countActiveCatalogItemsInCategory(ORG, 'cat-none')).toBe(0)
  })

  it('the delete-guard counts archived items too (no FK orphan); the dialog does not', async () => {
    // A category referenced ONLY by an archived item must still block hard-delete
    // (the item keeps its categoryId → deleting the category would orphan it).
    await create(service('only-archived', { categoryId: 'cat-arch', archivedAt: '2026-06-02' }))

    // Delete-vs-archive guard (all items): sees the archived reference → blocks.
    expect(await countCatalogItemsInCategory(ORG, 'cat-arch')).toBe(1)
    // Dialog warning (active only): no active item to re-bucket → 0.
    expect(await countActiveCatalogItemsInCategory(ORG, 'cat-arch')).toBe(0)
  })
})
