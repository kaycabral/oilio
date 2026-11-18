import { loadCatalogPage } from '@/features/catalog/adapters/load-catalog'
import { CatalogList } from '@/features/catalog/ui/CatalogList'
import { CategoryManager } from '@/features/catalog/ui/CategoryManager'
import { Main } from '@oilio/design'

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; categoryId?: string; q?: string }>
}) {
  const params = await searchParams
  const {
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
  } = await loadCatalogPage(params)

  return (
    <Main width="default" className="space-y-6">
      <CatalogList
        items={items}
        categoryLabelById={categoryLabelById}
        categories={categories}
        kindFilter={kindFilter}
        categoryFilter={categoryFilter}
        searchQuery={searchQuery}
        createKind={createKind}
        canManage={canManage}
        canDelete={canDelete}
        isFiltered={state === 'filtered-empty'}
      />

      {state !== 'empty' ? (
        <CategoryManager categories={categories} canManage={canManage} canDelete={canDelete} />
      ) : null}
    </Main>
  )
}
