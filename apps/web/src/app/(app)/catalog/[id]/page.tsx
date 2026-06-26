import { Breadcrumbs } from '@/components/breadcrumbs'
import { isCatalogService } from '@/domain'
import { loadEditCatalogItemPage } from '@/features/catalog/adapters/load-catalog'
import { CatalogItemForm } from '@/features/catalog/ui/CatalogItemForm'
import { ServiceProfessionalsForm } from '@/features/catalog/ui/ServiceProfessionalsForm'
import { Main } from '@cbrl/design'

export default async function EditCatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { item, units, categories, professionals } = await loadEditCatalogItemPage(id)

  return (
    <Main width="narrow" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: 'Catálogo', href: '/catalog' },
          { label: item.name, href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Editar item</h1>
      <CatalogItemForm kind={item.kind} item={item} units={units} categories={categories} />

      {isCatalogService(item) ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Profissionais que executam</h2>
          <p className="text-muted-foreground text-sm">
            Quem aparece no calendário público pra este serviço — mesmo dado também editável em{' '}
            <strong>Profissionais</strong>.
          </p>
          <ServiceProfessionalsForm service={item} professionals={professionals} />
        </section>
      ) : null}
    </Main>
  )
}
