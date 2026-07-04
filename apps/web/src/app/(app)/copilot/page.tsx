import { loadCopilotPage } from '@/features/copilot/adapters/load-copilot'
import { CopilotView } from '@/features/copilot/ui/CopilotView'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function CopilotPage() {
  const props = await loadCopilotPage()

  // Off-plan → 404, like a route that doesn't exist (brief 0088 AC-06).
  if (props.locked) notFound()

  return (
    <Main width="narrow">
      <CopilotView {...props} />
    </Main>
  )
}
