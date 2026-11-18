import { loadReportsPage } from '@/features/reports/adapters/load-reports'
import { ReportsView } from '@/features/reports/ui/ReportsView'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function ReportsHubPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const props = await loadReportsPage(await searchParams)

  if (!props.sales) notFound()

  return (
    <Main width="default">
      <ReportsView {...props} />
    </Main>
  )
}
