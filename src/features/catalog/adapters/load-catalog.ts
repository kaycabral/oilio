import {
  canManageOrg,
  normalizeCatalogItemKind,
  type CatalogItem,
  type CatalogItemKind,
  type Category,
  type StoredUnit,
} from '@/domain'
import { filterCatalogItems, normalizeKindFilter } from '@/features/catalog/core/catalog-item-form'
import { getCatalogItemById, listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { listCategoriesForOrg } from '@/shared/org/category-read'
import {
  attachCanDelete,
  catalogItemHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { listMemberOperationsForOrg } from '@/shared/org/member-operation-read'
import { requireCapabilityPage } from '@/shared/org/membership'
import { listStoredUnitsForOrg } from '@/shared/org/unit-read'
import { notFound } from 'next/navigation'
import 'server-only'

export type CatalogPageData = {
  items: WithCanDelete<CatalogItem & { id: string }>[]
  categories: (Category & { id: string })[]
  categoryLabelById: Map<string, string>
  kindFilter: 'all' | CatalogItemKind
  categoryFilter: string
  searchQuery: string
  createKind: CatalogItemKind
  canManage: boolean
  canDelete: boolean
  state: ListSurfaceState
}

export async function loadCatalogPage(rawParams: {
  kind?: string
  categoryId?: string
  q?: string
}): Promise<CatalogPageData> {
  const ctx = await requireCapabilityPage('canManageCatalog')

  const canManage = canManageOrg(ctx.membership.role)
  const canDelete = ctx.membership.role === 'owner'

  const kindFilter = normalizeKindFilter(rawParams.kind)
  const categoryFilter = rawParams.categoryId ?? ''
  const searchQuery = rawParams.q ?? ''
  const searchTerm = searchQuery.trim().toLowerCase()

  const [catalogItems, allCategories] = await Promise.all([
    listCatalogItems(ctx.membership.orgId),
    listCategoriesForOrg(ctx.membership.orgId),
  ])

  const allItems = catalogItems.filter((it) => !it.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)

  const categoryLabelById = new Map(categories.map((c) => [c.id, c.name]))

  const byKindAndCategory = filterCatalogItems(allItems, kindFilter, categoryFilter)
  const filtered = searchTerm
    ? byKindAndCategory.filter((it) => it.name.toLowerCase().includes(searchTerm))
    : byKindAndCategory
  const items = await attachCanDelete(filtered, (id) =>
    catalogItemHasActiveReference(ctx.membership.orgId, id),
  )

  const createKind: CatalogItemKind = kindFilter === 'product' ? 'product' : 'service'

  const state = resolveListSurfaceState({
    hasAnyData: allItems.length > 0,
    visibleCount: items.length,
  })

  return {
    items,
    categories,
    categoryLabelById,
    kindFilter,
    categoryFilter,
    searchQuery,
    createKind,
    canManage,
    canDelete,
    state,
  }
}

export type NewCatalogItemPageData = {
  kind: CatalogItemKind
  units: StoredUnit[]
  categories: Category[]
}

async function loadCatalogMasterData(
  orgId: string,
): Promise<{ units: StoredUnit[]; categories: Category[] }> {
  const [allUnits, allCategories] = await Promise.all([
    listStoredUnitsForOrg(orgId),
    listCategoriesForOrg(orgId),
  ])
  const units = allUnits.filter((u) => !u.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)
  return { units, categories }
}

export async function loadNewCatalogItemPage(rawParams: {
  kind?: string
}): Promise<NewCatalogItemPageData> {
  const ctx = await requireCapabilityPage('canManageCatalog')

  const kind: CatalogItemKind = normalizeCatalogItemKind(rawParams.kind)
  const { units, categories } = await loadCatalogMasterData(ctx.membership.orgId)
  return { kind, units, categories }
}

export type EditCatalogItemPageData = {
  item: CatalogItem & { id: string }
  units: StoredUnit[]
  categories: Category[]
  memberOperations: Awaited<ReturnType<typeof listMemberOperationsForOrg>>
}

export async function loadEditCatalogItemPage(itemId: string): Promise<EditCatalogItemPageData> {
  const ctx = await requireCapabilityPage('canManageCatalog')

  const [item, allUnits, allCategories, memberOperations] = await Promise.all([
    getCatalogItemById(ctx.membership.orgId, itemId),
    listStoredUnitsForOrg(ctx.membership.orgId),
    listCategoriesForOrg(ctx.membership.orgId),
    listMemberOperationsForOrg(ctx.membership.orgId),
  ])
  if (!item) notFound()
  const units = allUnits.filter((u) => !u.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)
  return { item, units, categories, memberOperations }
}
