import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadEditPlanPage } from '@/features/plans/adapters/load-plans'
import { PlanForm } from '@/features/plans/ui/PlanForm'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await loadEditPlanPage(id)

  // Off-plan → 404, like a route that doesn't exist (brief 0088 AC-06). Narrows
  // the union so `plan`/master-data are available below.
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
