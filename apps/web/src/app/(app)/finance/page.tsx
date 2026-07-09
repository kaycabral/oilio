import { loadFinancePage } from '@/features/finance/adapters/load-finance'
import { FinanceView } from '@/features/finance/ui/FinanceView'
import { Main } from '@cbrl/design'

export const dynamic = 'force-dynamic'

export default async function FinancePage() {
  const props = await loadFinancePage()

  return (
    <Main width="narrow">
      <FinanceView {...props} />
    </Main>
  )
}
