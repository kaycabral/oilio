import { loadMyAppointmentsPage } from '@/features/me/adapters/load-me'
import { AppointmentRow } from '@/features/me/ui/AppointmentRow'
import { Main } from '@cbrl/design'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Meus agendamentos' }

export default async function MyAppointmentsPage() {
  const { upcoming, past } = await loadMyAppointmentsPage()

  return (
    <Main width="narrow" className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Meus agendamentos</h1>
        <p className="text-muted-foreground text-sm">
          Próximos e histórico em todos os estabelecimentos onde você agendou.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Próximos</h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            Nenhum agendamento futuro. Encontre um estabelecimento e agende.
          </p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((row) => (
              <AppointmentRow key={row.appointmentId} data={row} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Histórico</h2>
          <ul className="space-y-3">
            {past.map((row) => (
              <AppointmentRow key={row.appointmentId} data={row} />
            ))}
          </ul>
        </section>
      ) : null}
    </Main>
  )
}
