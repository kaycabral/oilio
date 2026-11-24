import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import { aggregateRef, appendEvent } from '@/domain/effect'
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

const ORG = 'org-read'
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

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId],
  )
}

async function seedCategory(orgId: string, categoryId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO categories (org_id, id, last_event_version, name, icon, color, active, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Cat',NULL,NULL,true,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, categoryId],
  )
}

const create = async (item: CatalogServiceItem | CatalogProductItem) => {
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

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId],
  )
}

describe('Catalog-item reads — Postgres (brief 0058)', () => {
  beforeEach(async () => {
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
    await create(service('only-archived', { categoryId: 'cat-arch', archivedAt: '2026-06-02' }))

    expect(await countCatalogItemsInCategory(ORG, 'cat-arch')).toBe(1)
    expect(await countActiveCatalogItemsInCategory(ORG, 'cat-arch')).toBe(0)
  })
})
