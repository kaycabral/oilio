import {
  CatalogItem,
  Category,
  normalizeCatalogItemKind,
  StoredUnit,
  type CatalogItemKind,
} from '@/domain'
import { filterCatalogItems, normalizeKindFilter } from '@/features/catalog/core/catalog-item-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import {
  attachCanDelete,
  catalogItemHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { getActiveOrgContext } from '@/shared/org/membership'
import { listProfessionalsForOrg } from '@/shared/org/professional-read'
import { notFound, redirect } from 'next/navigation'
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
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const canDelete = ctx.membership.role === 'owner'

  const kindFilter = normalizeKindFilter(rawParams.kind)
  const categoryFilter = rawParams.categoryId ?? ''
  const searchQuery = rawParams.q ?? ''
  const searchTerm = searchQuery.trim().toLowerCase()

  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  const [itemsSnap, categoriesSnap] = await Promise.all([
    orgRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .orderBy('name')
      .get(),
    orgRef.collection('categories').withConverter(fsConverter(Category)).orderBy('name').get(),
  ])

  // Filtered in-memory (truthy `archivedAt`) so legacy docs without the field
  // still surface.
  const allItems = itemsSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((it) => !it.archivedAt)
  const allCategories = categoriesSnap.docs.map((d) => ({ ...d.data(), id: d.id }))
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
  const orgRef = getAdminFirestore().collection('orgs').doc(orgId)
  const [unitsSnap, categoriesSnap] = await Promise.all([
    orgRef.collection('units').withConverter(fsConverter(StoredUnit)).orderBy('name').get(),
    orgRef.collection('categories').withConverter(fsConverter(Category)).orderBy('name').get(),
  ])
  // Archived master data (brief 0027, AC-06) is hidden from the item-form
  // pickers; existing items keep resolving their frozen ids.
  const units = unitsSnap.docs.map((d) => d.data()).filter((u) => !u.archivedAt)
  const categories = categoriesSnap.docs.map((d) => d.data()).filter((c) => !c.archivedAt)
  return { units, categories }
}

function requireManagerSession(role: string): void {
  if (role !== 'owner' && role !== 'manager') redirect('/catalog')
}

// Imperative shell for the new-item route.
export async function loadNewCatalogItemPage(rawParams: {
  kind?: string
}): Promise<NewCatalogItemPageData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  requireManagerSession(ctx.membership.role)

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
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  requireManagerSession(ctx.membership.role)

  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  const [snap, unitsSnap, categoriesSnap, professionals] = await Promise.all([
    orgRef.collection('catalog_items').withConverter(fsConverter(CatalogItem)).doc(itemId).get(),
    orgRef.collection('units').withConverter(fsConverter(StoredUnit)).orderBy('name').get(),
    orgRef.collection('categories').withConverter(fsConverter(Category)).orderBy('name').get(),
    listProfessionalsForOrg(ctx.membership.orgId),
  ])
  const itemData = snap.data()
  const item = itemData ? { ...itemData, id: snap.id } : undefined
  if (!item) notFound()
  const units = unitsSnap.docs.map((d) => d.data()).filter((u) => !u.archivedAt)
  const categories = categoriesSnap.docs.map((d) => d.data()).filter((c) => !c.archivedAt)
  return { item, units, categories, professionals }
}
