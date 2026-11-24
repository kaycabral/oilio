import { loadAgendaPage } from '@/features/agenda/adapters/load-agenda'
import { AgendaView } from '@/features/agenda/ui/AgendaView'
import { Main } from '@cbrl/design'

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; showCancelled?: string }>
}) {
  const props = await loadAgendaPage(await searchParams)
  return (
    <Main width="default">
      <AgendaView {...props} />
    </Main>
  )
}
