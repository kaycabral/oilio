import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadNewCatalogItemPage } from '@/features/catalog/adapters/load-catalog'
import { CatalogItemForm } from '@/features/catalog/ui/CatalogItemForm'
import { Main } from '@cbrl/design'

export default async function NewCatalogItemPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const params = await searchParams
  const { kind, units, categories } = await loadNewCatalogItemPage(params)

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Catálogo', href: '/catalog' },
          { label: 'Novo', href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Novo item</h1>
      <CatalogItemForm kind={kind} units={units} categories={categories} />
    </Main>
  )
}
