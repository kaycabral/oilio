import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadNewPlanPage } from '@/features/plans/adapters/load-plans'
import { PlanForm } from '@/features/plans/ui/PlanForm'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function NewPlanPage() {
  await connection()
  const { units, catalogItems, categories, locked } = await loadNewPlanPage()

  if (locked) notFound()

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Planos', href: '/plans' },
          { label: 'Novo', href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Novo plano</h1>
      <PlanForm units={units} catalogItems={catalogItems} categories={categories} />
    </Main>
  )
}
