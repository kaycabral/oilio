import { UpgradeCta } from '@/features/billing/ui/UpgradeGate'
import { loadCopilotPage } from '@/features/copilot/adapters/load-copilot'
import { CopilotView } from '@/features/copilot/ui/CopilotView'
import { Main } from '@cbrl/design'

export const dynamic = 'force-dynamic'

export default async function CopilotPage() {
  const props = await loadCopilotPage()
  return (
    <Main width="narrow">
      {props.locked ? <UpgradeCta capability="copilot.profit_goal" /> : <CopilotView {...props} />}
    </Main>
  )
}
