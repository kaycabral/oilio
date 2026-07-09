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

    await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: 'Corte Referenciando',
      categoryId,
      unitIds: org.unitIds,
    })
    await seedSubscriptionPlan(org.orgId, { includedCategoryIds: [categoryId] })

    const itemRefs = await pgQueryProjection('catalog_items', 'category_id', categoryId)
    const planRefs = await planRefCount(org.orgId, categoryId)
    expect(itemRefs).not.toHaveLength(0)
    expect(planRefs).toBeGreaterThan(0)

    const freeCategoryId = await seedCategory(org.orgId, { name: 'Livre' })
    const freeItemRefs = await pgQueryProjection('catalog_items', 'category_id', freeCategoryId)
    const freePlanRefs = await planRefCount(org.orgId, freeCategoryId)
    expect(freeItemRefs).toHaveLength(0)
    expect(freePlanRefs).toBe(0)
  })
})
