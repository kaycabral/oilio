import { loadAgendaPage } from '@/features/agenda/adapters/load-agenda'
import { AgendaView } from '@/features/agenda/ui/AgendaView'
import { Main } from '@cbrl/design'
import { connection } from 'next/server'

export const instant = false

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; showCancelled?: string }>
}) {
  await connection()
  const props = await loadAgendaPage(await searchParams)
  return (
    <Main width="default">
      <AgendaView {...props} />
    </Main>
  )
}
