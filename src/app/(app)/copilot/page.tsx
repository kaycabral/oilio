import { loadCopilotPage } from '@/features/copilot/adapters/load-copilot'
import { CopilotView } from '@/features/copilot/ui/CopilotView'
import { isFeatureEnabled } from '@/shared/flags'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

export default async function CopilotPage() {
  await connection()
  if (!isFeatureEnabled('copilot')) notFound()

  const props = await loadCopilotPage()

  if (props.locked) notFound()

  return (
    <Main width="narrow">
      <CopilotView {...props} />
    </Main>
  )
}
