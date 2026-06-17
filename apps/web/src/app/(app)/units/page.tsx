import { loadUnitsPage } from '@/features/units/adapters/load-units'
import { UnitsList } from '@/features/units/ui/UnitsList'
import { Main } from '@cbrl/design'

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string }>
}) {
  const { units, searchQuery, modeFilter, canDelete, state } = await loadUnitsPage(
    await searchParams,
  )

  return (
    <Main width="default">
      <UnitsList
        units={units}
        searchQuery={searchQuery}
        modeFilter={modeFilter}
        canManage
        canDelete={canDelete}
        isFiltered={state === 'filtered-empty'}
      />
    </Main>
  )
}
