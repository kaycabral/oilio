import type { UnitHoursMode } from '@/domain'
import { getUnitPublishReadiness } from '@/features/units/adapters/units.actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cbrl/design'
import { Check, X } from 'lucide-react'

// SPIKE (inferred availability): no publish button. A unit in "Por agendamento"
// mode goes live automatically once it meets the minimum (hours + public
// service + approved professional). This card is just FEEDBACK — it tells the
// owner whether the agenda is visible and, if not, exactly what's missing.
// Hidden entirely for non-appointment units (the agenda isn't relevant there).
export async function UnitPublishCard({
  orgId,
  unitId,
  hoursMode,
}: {
  orgId: string
  unitId: string
  hoursMode: UnitHoursMode | undefined
}) {
  if (hoursMode !== 'appointment') return null
  const readiness = await getUnitPublishReadiness(orgId, unitId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agendamento público desta unidade</CardTitle>
        <CardDescription>
          {readiness.ready
            ? 'No ar — clientes já podem agendar nesta unidade. Some sozinha do público se faltar algum requisito.'
            : 'Assim que os requisitos abaixo forem atendidos, a agenda fica visível automaticamente — sem botão de publicar.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm" data-slot="unit-agenda-readiness">
          {Object.values(REQUIREMENTS).map((req) => {
            const ok = !readiness.missing.includes(req)
            return (
              <li key={req} className="flex items-center gap-2">
                {ok ? (
                  <Check className="size-4 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <X className="text-muted-foreground size-4" aria-hidden />
                )}
                <span className={ok ? '' : 'text-muted-foreground'}>{req}</span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

// Mirrors `getUnitPublishReadiness`'s missing[] strings.
const REQUIREMENTS = {
  address: 'Endereço e horário de funcionamento preenchidos',
  service: '1 serviço público oferecido nesta unidade',
  professional: '1 profissional aprovado nesta unidade',
} as const
