import { loadReportsPage } from '@/features/reports/adapters/load-reports'
import { ReportsView } from '@/features/reports/ui/ReportsView'
import { Main } from '@cbrl/design'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function ReportsHubPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const props = await loadReportsPage(await searchParams)
  return (
    <Main width="default">
      <ReportsView {...props} />
    </Main>
  )
}
