import { loadPlansPage } from '@/features/plans/adapters/load-plans'
import { PlansList } from '@/features/plans/ui/PlansList'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export const instant = false

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cycle?: string; status?: string }>
}) {
  const { plans, searchQuery, cycleFilter, statusFilter, canManage, canDelete, state, locked } =
    await loadPlansPage(await searchParams)

  if (locked) notFound()

  return (
    <Main width="default">
      <PlansList
        plans={plans}
        searchQuery={searchQuery}
        cycleFilter={cycleFilter}
        statusFilter={statusFilter}
        canManage={canManage}
        canDelete={canDelete}
        isFiltered={state === 'filtered-empty'}
      />
    </Main>
  )
}
