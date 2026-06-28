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
import { requireCapabilityPage } from '@/shared/org/membership'
import { listProfessionalsForOrg } from '@/shared/org/professional-read'
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

// Imperative shell for the unified catalog list (brief 0023, AC-09). Archived
// items/categories (brief 0027, AC-06) drop from the active surface but stay
// resolvable for historical plans/orders. Filters + search read from URL search
// params (RSC re-query); pagination is client-side.
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
    // Backend-aware (Postgres typed table under RLS / Firestore subcollection),
    // ordered by name — feature D. Includes archived; filtered in JS below.
    listCategoriesForOrg(ctx.membership.orgId),
  ])

  // Filtered in-memory (truthy `archivedAt`) so legacy docs without the field
  // still surface.
  const allItems = catalogItems.filter((it) => !it.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)

  // Category-label resolution covers only ACTIVE categories (brief 0033, AC-11):
  // an item pointing at an archived/deleted category resolves to "Sem categoria"
  // in the table — never the raw id.
  const categoryLabelById = new Map(categories.map((c) => [c.id, c.name]))

  const byKindAndCategory = filterCatalogItems(allItems, kindFilter, categoryFilter)
  const filtered = searchTerm
    ? byKindAndCategory.filter((it) => it.name.toLowerCase().includes(searchTerm))
    : byKindAndCategory
  // Per-row reference-based flag (brief 0033, AC-03 — #1068 precompute).
  const items = await attachCanDelete(filtered, (id) =>
    catalogItemHasActiveReference(ctx.membership.orgId, id),
  )

  const createKind: CatalogItemKind = kindFilter === 'product' ? 'product' : 'service'

  // `allItems` (unfiltered active set) is the "any data?" signal; `items` is the
  // kind/category/search slice.
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
  // Archived master data (brief 0027, AC-06) is hidden from the item-form
  // pickers; existing items keep resolving their frozen ids.
  const units = allUnits.filter((u) => !u.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)
  return { units, categories }
}

// Imperative shell for the new-item route.
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
  professionals: Awaited<ReturnType<typeof listProfessionalsForOrg>>
}

// Imperative shell for the edit route — gate, resolve the item (404), then the
// form master data + professionals (for the service ↔ pro link section).
export async function loadEditCatalogItemPage(itemId: string): Promise<EditCatalogItemPageData> {
  const ctx = await requireCapabilityPage('canManageCatalog')

  const [item, allUnits, allCategories, professionals] = await Promise.all([
    getCatalogItemById(ctx.membership.orgId, itemId),
    listStoredUnitsForOrg(ctx.membership.orgId),
    listCategoriesForOrg(ctx.membership.orgId),
    listProfessionalsForOrg(ctx.membership.orgId),
  ])
  if (!item) notFound()
  const units = allUnits.filter((u) => !u.archivedAt)
  const categories = allCategories.filter((c) => !c.archivedAt)
  return { item, units, categories, professionals }
}
