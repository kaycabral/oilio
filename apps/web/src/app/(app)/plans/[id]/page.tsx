import { Breadcrumbs } from '@/components/breadcrumbs'
import { UpgradeCta } from '@/features/billing/ui/UpgradeGate'
import { loadEditPlanPage } from '@/features/plans/adapters/load-plans'
import { PlanForm } from '@/features/plans/ui/PlanForm'
import { Main } from '@cbrl/design'

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { plan, units, catalogItems, categories, locked } = await loadEditPlanPage(id)

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Planos', href: '/plans' },
          { label: plan.name, href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Editar plano</h1>
      {locked ? (
        <UpgradeCta capability="plans.recurring" />
      ) : (
        <PlanForm plan={plan} units={units} catalogItems={catalogItems} categories={categories} />
      )}
    </Main>
  )
}
