import { loadCopilotPage } from '@/features/copilot/adapters/load-copilot'
import { CopilotView } from '@/features/copilot/ui/CopilotView'
import { isFeatureEnabled } from '@/shared/flags'
import { Main } from '@oilio/design'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function CopilotPage() {
  if (!isFeatureEnabled('copilot')) notFound()

  const props = await loadCopilotPage()

  if (props.locked) notFound()

  return (
    <Main width="narrow">
      <CopilotView {...props} />
    </Main>
  )
}
