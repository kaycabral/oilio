import { loadDashboardPage } from '@/features/dashboard/adapters/load-dashboard'
import { DashboardView } from '@/features/dashboard/ui/DashboardView'
import { Main } from '@cbrl/design'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const props = await loadDashboardPage(await searchParams)
  return (
    <Main width="default">
      <DashboardView {...props} />
    </Main>
  )
}
