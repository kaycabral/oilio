import { loadFinancePage } from '@/features/finance/adapters/load-finance'
import { FinanceView } from '@/features/finance/ui/FinanceView'
import { isFeatureEnabled } from '@/shared/flags'
import { Main } from '@oilio/design'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function FinancePage() {
  if (!isFeatureEnabled('finance')) notFound()

  const props = await loadFinancePage()

  return (
    <Main width="narrow">
      <FinanceView {...props} />
    </Main>
  )
}
