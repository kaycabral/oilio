import { loadFinancePage } from '@/features/finance/adapters/load-finance'
import { FinanceView } from '@/features/finance/ui/FinanceView'
import { isFeatureEnabled } from '@/shared/flags'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function FinancePage() {
  await connection()
  if (!isFeatureEnabled('finance')) notFound()

  const props = await loadFinancePage()

  return (
    <Main width="narrow">
      <FinanceView {...props} />
    </Main>
  )
}
