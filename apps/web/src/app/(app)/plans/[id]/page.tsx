import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadEditPlanPage } from '@/features/plans/adapters/load-plans'
import { PlanForm } from '@/features/plans/ui/PlanForm'
import { Main } from '@oilio/design'
import { notFound } from 'next/navigation'

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await loadEditPlanPage(id)

  if (data.locked) notFound()

  const { plan, units, catalogItems, categories } = data

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Planos', href: '/plans' },
          { label: plan.name, href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Editar plano</h1>
      <PlanForm plan={plan} units={units} catalogItems={catalogItems} categories={categories} />
    </Main>
  )
}
