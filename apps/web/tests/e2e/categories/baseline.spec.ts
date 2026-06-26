// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md) para a
// entidade Category (brief 0023, #1003).
//
// COBERTURA: este slice ADICIONA a entidade `Category` (coleção `categories`
// + server actions + FK em CatalogItem/SubscriptionPlan), mas a UI de CRUD de
// categorias é #1005. Em vez de dirigir uma UI inexistente, este baseline
// exercita o caminho fim-a-fim que já existe: a projeção `categories` em
// Postgres (event store, pós-cutover #1202) + a FK que liga itens/planos à
// categoria.
//
//   - empty: leitura da projeção ausente retorna null (doc inexistente, não
//     erro). O gate de acesso (RLS) é provado nos specs de isolamento.
//   - create→read: seed (admin) de categoria → leitura da projeção tipada →
//     projeção campo a campo (rename via update é coberto no replay test do
//     aggregate).
//   - degenerado: categoria sem icon/color projeta `null` fielmente.
//   - AC-05 (delete-in-use): seed categoria + item do catálogo + plano que a
//     referenciam → a MESMA query do guard de `deleteCategory`
//     (`category_id ==` / `included_category_ids array-contains`) encontra as
//     referências, provando que o delete seria bloqueado. O bloqueio em si
//     (thrown error) é coberto pelo unit da server action; o CRUD visual entra
//     no E2E de #1005.

import { CategoryConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { expect, test } from '../fixtures'
import {
  pgListByOrg,
  pgProjectionExists,
  pgQueryProjection,
  pgReadProjection,
  seedCatalogItem,
  seedCategory,
  seedSubscriptionPlan,
} from '../helpers/session'

// Conta planos do org cuja lista `included_category_ids` (JSONB array) contém
// `categoryId` — espelha o guard `array-contains` de `deleteCategory`. O pg
// devolve o JSONB já decodificado; filtramos com type-guards (sem cast).
async function planRefCount(orgId: string, categoryId: string): Promise<number> {
  const rows = await pgListByOrg('subscription_plans', orgId)
  return rows.filter((r) => {
    const ids = r.included_category_ids
    return Array.isArray(ids) && ids.includes(categoryId)
  }).length
}

test.describe('Category — baseline (#1003)', () => {
  test('projeção ausente: leitura não falha (retorna null)', async ({ org }) => {
    const exists = await pgProjectionExists(
      'categories',
      aggregateRef(CategoryConfig, org.orgId, 'inexistente'),
    )
    // Doc ausente → não existe projeção. O gate de acesso (RLS) é provado nos
    // specs de isolamento; aqui o ponto é que a leitura não quebra.
    expect(exists).toBe(false)
  })

  test('cria (seed) → lê projeção → projeta campo a campo', async ({ org }) => {
    const id = await seedCategory(org.orgId, {
      name: 'Cabelo',
      icon: 'scissors',
      color: '#3366ff',
      active: true,
    })
    const row = await pgReadProjection('categories', aggregateRef(CategoryConfig, org.orgId, id))
    expect(row).not.toBeNull()
    expect(row?.name).toBe('Cabelo')
    expect(row?.icon).toBe('scissors')
    expect(row?.color).toBe('#3366ff')
    expect(row?.active).toBe(true)
  })

  test('dado degenerado (categoria sem icon/color) projeta nulls', async ({ org }) => {
    const id = await seedCategory(org.orgId, {
      name: 'Estética',
      icon: null,
      color: null,
      active: false,
    })
    const row = await pgReadProjection('categories', aggregateRef(CategoryConfig, org.orgId, id))
    expect(row).not.toBeNull()
    expect(row?.icon).toBeNull()
    expect(row?.color).toBeNull()
    expect(row?.active).toBe(false)
  })

  test('AC-05 — categoria em uso é detectada (guard de delete bloquearia)', async ({ org }) => {
    const categoryId = await seedCategory(org.orgId, { name: 'Em Uso' })

    // Item do catálogo apontando pra categoria via FK.
    await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: 'Corte Referenciando',
      categoryId,
      unitIds: org.unitIds,
    })
    // Plano incluindo a categoria via FK array.
    await seedSubscriptionPlan(org.orgId, { includedCategoryIds: [categoryId] })

    // A MESMA query do guard de `deleteCategory` — ambas as referências
    // precisam ser encontradas, provando que o delete seria bloqueado.
    const itemRefs = await pgQueryProjection('catalog_items', 'category_id', categoryId)
    const planRefs = await planRefCount(org.orgId, categoryId)
    expect(itemRefs).not.toHaveLength(0)
    expect(planRefs).toBeGreaterThan(0)

    // Categoria não referenciada → guard libera (0 refs).
    const freeCategoryId = await seedCategory(org.orgId, { name: 'Livre' })
    const freeItemRefs = await pgQueryProjection('catalog_items', 'category_id', freeCategoryId)
    const freePlanRefs = await planRefCount(org.orgId, freeCategoryId)
    expect(freeItemRefs).toHaveLength(0)
    expect(freePlanRefs).toBe(0)
  })
})
