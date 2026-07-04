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

  // Off-plan → 404, like a route that doesn't exist (brief 0088 AC-06). Reports is
  // gated by `reports.sales`; the loader returns `sales: null` exactly when the
  // tier lacks it (and materialized nothing). A per-section capability (commissions)
  // the tier lacks is hidden inside `ReportsView`, not upsold.
  if (!props.sales) notFound()

  return (
    <Main width="default">
      <ReportsView {...props} />
    </Main>
  )
}
