// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md) para o
// modelo CatalogItem unificado (brief 0023, #1002).
//
// COBERTURA: este slice ADICIONA o modelo unificado + tabela `catalog_items`
// + server actions, mas a UI de CRUD do catálogo unificado é #1005 (os fluxos
// visuais hoje vivem em /services e /products). Portanto, em vez de dirigir uma
// UI inexistente, este baseline exercita o caminho fim-a-fim que já existe: a
// projeção `catalog_items` no event store. Seed (admin) de ambos os kinds + 1
// degenerado → leitura da projeção tipada → asserção campo a campo. O CRUD via
// server actions é provado pelo teste de replay do aggregate
// (`catalog-item-replay.test.ts`) e pelo unit das próprias actions. O CRUD
// visual entra no E2E de #1005.
//
// Pós-cutover (#1202): a projeção vive na tabela tipada `catalog_items` do
// Postgres — não há mais doc Firestore lido sob Security Rules. As rules eram um
// conceito do Firestore; a tabela tipada + suas constraints são provadas pela
// suíte de integração pg. Este baseline assere a projeção lida direto do
// Postgres (`pgReadProjection`) — Postgres é o backend único pós-cutover, sem
// gate de flag.

import { CatalogItemConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { pgReadProjection, seedCatalogItem, seedCategory } from '../helpers/session'

// Lenient row schemas: descrevem só as colunas que cada assert toca; colunas
// extras da linha real decodificam fine. Colunas numéricas do Postgres voltam
// como string OU number (driver `pg`), então `duration_minutes`/`stock` aceitam
// ambos. JSONB `commission` é null ou objeto.
const ServiceRow = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  duration_minutes: Schema.Union(Schema.String, Schema.Number, Schema.Null),
})
const ProductRow = Schema.Struct({
  kind: Schema.String,
  sku: Schema.Union(Schema.String, Schema.Null),
  stock: Schema.Union(Schema.String, Schema.Number, Schema.Null),
})
const DegenerateRow = Schema.Struct({
  kind: Schema.String,
  category_id: Schema.Union(Schema.String, Schema.Null),
  commission: Schema.Unknown,
})

const decodeService = Schema.decodeUnknownSync(ServiceRow)
const decodeProduct = Schema.decodeUnknownSync(ProductRow)
const decodeDegenerate = Schema.decodeUnknownSync(DegenerateRow)

// Normaliza colunas numéricas do Postgres (string | number) pra number.
function asNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value)
}

test.describe('CatalogItem — baseline (#1002)', () => {
  test('coleção vazia: projeção ausente lê como null', async ({ org }) => {
    const row = await pgReadProjection(
      'catalog_items',
      aggregateRef(CatalogItemConfig, org.orgId, 'inexistente'),
    )
    // Projeção ausente → null (nenhuma linha pra esse aggregate). O ponto
    // é que a leitura do membro não falha — só não encontra o item.
    expect(row).toBeNull()
  })

  test('cria (seed) → lê projeção → ambos os kinds projetam', async ({ org }) => {
    // The item → category FK (#1220 D2) rejects an orphan category id, so seed
    // the parent categories first and reference their real ids.
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
