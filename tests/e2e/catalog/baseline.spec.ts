import { CatalogItemConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { pgReadProjection, seedCatalogItem, seedCategory } from '../helpers/session'

const ServiceRow = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  duration_minutes: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
})
const ProductRow = Schema.Struct({
  kind: Schema.String,
  sku: Schema.Union([Schema.String, Schema.Null]),
  stock: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
})
const DegenerateRow = Schema.Struct({
  kind: Schema.String,
  category_id: Schema.Union([Schema.String, Schema.Null]),
  commission: Schema.Unknown,
})

const decodeService = Schema.decodeUnknownSync(ServiceRow)
const decodeProduct = Schema.decodeUnknownSync(ProductRow)
const decodeDegenerate = Schema.decodeUnknownSync(DegenerateRow)

function asNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value)
}

test.describe('CatalogItem — baseline (#1002)', () => {
  test('coleção vazia: projeção ausente lê como null', async ({ org }) => {
    const row = await pgReadProjection(
      'catalog_items',
      aggregateRef(CatalogItemConfig, org.orgId, 'inexistente'),
    )
    expect(row).toBeNull()
  })

  test('cria (seed) → lê projeção → ambos os kinds projetam', async ({ org }) => {
    const corteCatId = await seedCategory(org.orgId, { name: 'Corte' })
    const pomadaCatId = await seedCategory(org.orgId, { name: 'Pomada' })
    const serviceId = await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: 'Corte Baseline',
      categoryId: corteCatId,
      priceCents: 5000,
      durationMinutes: 30,
      unitIds: org.unitIds,
      commission: { kind: 'percentage', value: 50 },
    })
    const productId = await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Pomada Baseline',
      categoryId: pomadaCatId,
      priceCents: 3000,
      sku: 'POM-1',
      stock: 10,
      unitIds: org.unitIds,
    })

    const svcRow = await pgReadProjection(
      'catalog_items',
      aggregateRef(CatalogItemConfig, org.orgId, serviceId),
    )
    const svc = decodeService(svcRow)
    expect(svc.kind).toBe('service')
    expect(svc.name).toBe('Corte Baseline')
    expect(asNumber(svc.duration_minutes)).toBe(30)

    const prodRow = await pgReadProjection(
      'catalog_items',
      aggregateRef(CatalogItemConfig, org.orgId, productId),
    )
    const prod = decodeProduct(prodRow)
    expect(prod.kind).toBe('product')
    expect(prod.sku).toBe('POM-1')
    expect(asNumber(prod.stock)).toBe(10)
  })

  test('dado degenerado (produto sem categoria e sem comissão) projeta', async ({ org }) => {
    const id = await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Item Degenerado',
      categoryId: null,
      commission: null,
      priceCents: 0,
      stock: 0,
      sku: null,
      unitIds: org.unitIds,
      active: false,
    })
    const row = await pgReadProjection(
      'catalog_items',
      aggregateRef(CatalogItemConfig, org.orgId, id),
    )
    const degenerate = decodeDegenerate(row)
    expect(degenerate.category_id).toBeNull()
    expect(degenerate.commission).toBeNull()
    expect(degenerate.kind).toBe('product')
  })
})
