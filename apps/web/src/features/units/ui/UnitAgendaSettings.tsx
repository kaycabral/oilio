import { appointmentAgenda, type Unit } from '@/domain'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@cbrl/design'

// The agenda-mode-only settings of a Unit (PRD Identidade v2 / C3): the
// cancellation policy + confirmation/reminder/cancellation messages. These moved
// Org→Unit and live ONLY in `appointment` mode — there is NO separate global
// "Políticas" page anymore (it was retired). This card therefore renders only
// when the unit is in appointment mode; for fixed/always_open it renders
// nothing (the configs don't exist by construction).
export function UnitAgendaSettings({ unit }: { unit: Unit }) {
  const appointment = appointmentAgenda(unit.agenda)
  if (!appointment) return null

  const { cancellationPolicy, confirmationTemplates } = appointment

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Agenda · políticas e mensagens</CardTitle>
        <Badge variant="secondary">Por agendamento</Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Política de cancelamento</h3>
          {cancellationPolicy.enabled ? (
            <p className="text-muted-foreground text-sm">
              Cancelamento pelo cliente permitido com antecedência mínima de{' '}
              {cancellationPolicy.minNoticeMinutes} minutos.
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">Cancelamento pelo cliente desativado.</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Mensagens automáticas</h3>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Confirmação</dt>
            <dd className="whitespace-pre-wrap">{confirmationTemplates.confirmation || '—'}</dd>
            <dt className="text-muted-foreground">Lembrete</dt>
            <dd className="whitespace-pre-wrap">{confirmationTemplates.reminder || '—'}</dd>
            <dt className="text-muted-foreground">Cancelamento</dt>
            <dd className="whitespace-pre-wrap">{confirmationTemplates.cancellation || '—'}</dd>
          </dl>
        </section>
      </CardContent>
    </Card>
  )
}
