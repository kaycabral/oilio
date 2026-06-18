import { describe, expect, it } from 'vitest'
import {
  catalogProductToProduct,
  catalogServiceToService,
  resolveCatalogItemForUnit,
  toPublicCatalogItem,
  type CatalogProductItem,
  type CatalogServiceItem,
} from './catalog-item'

// Consumer-migration adapters (brief 0023, #1004). These keep the legacy
// service/product pipelines working against the unified `catalog_items` model
// and add the public both-kinds projection.

function buildServiceItem(overrides: Partial<CatalogServiceItem> = {}): CatalogServiceItem {
  return {
    id: 's1',
    orgId: 't1',
    kind: 'service',
    name: 'Corte',
    categoryId: 'cat-cabelo',
    priceCents: 5000,
    commission: { kind: 'percentage', value: 40 },
    unitIds: ['u1', 'u2'],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: 30,
    requiredResources: ['cadeira'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildProductItem(overrides: Partial<CatalogProductItem> = {}): CatalogProductItem {
  return {
    id: 'p1',
    orgId: 't1',
    kind: 'product',
    name: 'Pomada',
    categoryId: null,
    priceCents: 3500,
    commission: null,
    unitIds: ['u1'],
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    sku: 'POM-01',
    stock: 40,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveCatalogItemForUnit', () => {
  it('returns base attributes for a service with no overrides', () => {
    const r = resolveCatalogItemForUnit(buildServiceItem(), 'u1')
    expect(r).toEqual({
      priceCents: 5000,
      durationMinutes: 30,
      commission: { kind: 'percentage', value: 40 },
    })
  })

  it('applies a full per-unit override (price + duration + commission)', () => {
    const item = buildServiceItem({
      unitOverrides: {
        u2: { priceCents: 9000, durationMinutes: 45, commission: { kind: 'fixed', value: 2000 } },
      },
    })
    expect(resolveCatalogItemForUnit(item, 'u2')).toEqual({
      priceCents: 9000,
      durationMinutes: 45,
      commission: { kind: 'fixed', value: 2000 },
    })
  })

  it('lets an override null out commission for a specific unit', () => {
    const item = buildServiceItem({ unitOverrides: { u2: { commission: null } } })
    expect(resolveCatalogItemForUnit(item, 'u2').commission).toBeNull()
  })

  it('resolves a product with durationMinutes 0 and supports price override', () => {
    const item = buildProductItem({ unitOverrides: { u1: { priceCents: 4000 } } })
    expect(resolveCatalogItemForUnit(item, 'u1')).toEqual({
      priceCents: 4000,
      durationMinutes: 0,
      commission: null,
    })
  })
})

describe('catalogServiceToService', () => {
  it('maps categoryId onto the legacy category label and preserves identity/snapshots', () => {
    const svc = catalogServiceToService(
      buildServiceItem({ unitOverrides: { u2: { priceCents: 1 } } }),
    )
    expect(svc.id).toBe('s1')
    expect(svc.name).toBe('Corte')
    expect(svc.category).toBe('cat-cabelo')
    expect(svc.priceCents).toBe(5000)
    expect(svc.durationMinutes).toBe(30)
    expect(svc.commission).toEqual({ kind: 'percentage', value: 40 })
    expect(svc.requiredResources).toEqual(['cadeira'])
    expect(svc.unitOverrides).toEqual({ u2: { priceCents: 1 } })
    // The adapted Service has no `kind` discriminant — it's the legacy shape.
    expect('kind' in svc).toBe(false)
  })
})

describe('catalogProductToProduct', () => {
  it('maps to the legacy Product shape (sku/stock preserved, no kind)', () => {
    const prod = catalogProductToProduct(buildProductItem())
    expect(prod).toEqual({
      id: 'p1',
      orgId: 't1',
      name: 'Pomada',
      sku: 'POM-01',
      priceCents: 3500,
      stock: 40,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })
})

describe('toPublicCatalogItem', () => {
  it('projects a service with resolved price/duration and the public allowlist', () => {
    const pub = toPublicCatalogItem(
      buildServiceItem({ unitOverrides: { u1: { priceCents: 7000 } } }),
      'u1',
    )
    expect(Object.keys(pub).sort()).toEqual(
      [
        'categoryId',
        'durationMinutes',
        'id',
        'kind',
        'name',
        'priceCents',
        'requiredResources',
      ].sort(),
    )
    expect(pub.kind).toBe('service')
    expect(pub.priceCents).toBe(7000)
    expect(pub.durationMinutes).toBe(30)
  })

  it('projects a product with null durationMinutes and empty requiredResources', () => {
    const pub = toPublicCatalogItem(buildProductItem(), 'u1')
    expect(pub.kind).toBe('product')
    expect(pub.durationMinutes).toBeNull()
    expect(pub.requiredResources).toEqual([])
    expect(pub.priceCents).toBe(3500)
  })

  it("renders priceCents=null when priceVisibility='on_request'", () => {
    const pub = toPublicCatalogItem(buildServiceItem({ priceVisibility: 'on_request' }), 'u1')
    expect(pub.priceCents).toBeNull()
    expect(pub.durationMinutes).toBe(30)
  })
})
