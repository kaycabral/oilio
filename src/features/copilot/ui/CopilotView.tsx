import type { Goal } from '@/domain'
import type { CopilotPageProps } from '@/features/copilot/adapters/load-copilot'
import { formatPeriodLabel } from '@/features/copilot/core/period'
import type { GoalTracking } from '@/features/copilot/core/tracking'
import { GoalForm } from './GoalForm'
import { GoalTrackingPanel } from './GoalTrackingPanel'

export function CopilotView(props: CopilotPageProps) {
  if (!props.hasActiveUnit) {
    return (
      <CopilotShell period={props.period}>
        <p className="text-muted-foreground text-sm">
          Selecione uma unidade no topo para definir a meta.
        </p>
      </CopilotShell>
    )
  }

  return (
    <CopilotShell period={props.period}>
      <SingleUnitBody
        unitId={props.unitId}
        period={props.period}
        goal={props.goal}
        tracking={props.tracking}
        mrrCents={props.mrrCents}
      />
    </CopilotShell>
  )
}

function CopilotShell({ period, children }: { period: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Copiloto</h1>
        <p className="text-muted-foreground text-sm">
          Sua meta de lucro de {formatPeriodLabel(period)} e a distância até ela.
        </p>
      </header>
      {children}
    </div>
  )
}

function SingleUnitBody({
  unitId,
  period,
  goal,
  tracking,
  mrrCents,
}: {
  unitId: string
  period: string
  goal: Goal | null
  tracking: GoalTracking | null
  mrrCents: number
}) {
  if (goal && tracking) {
    return (
      <section className="border-border space-y-4 rounded-md border p-4">
        <GoalTrackingPanel tracking={tracking} mrrCents={mrrCents} />
        <div className="border-t pt-4">
          <p className="mb-2 text-sm font-medium">Editar meta</p>
          <GoalForm unitId={unitId} period={period} goal={goal} />
        </div>
      </section>
    )
  }

  return (
    <section className="border-border space-y-3 rounded-md border border-dashed p-6">
      <div className="space-y-1">
        <h2 className="font-medium">Defina sua meta de lucro</h2>
        <p className="text-muted-foreground text-sm">
          Diga quanto de lucro você quer fechar neste mês. O Copiloto acompanha o realizado, o ritmo
          necessário e a projeção de fechamento.
        </p>
      </div>
      <GoalForm unitId={unitId} period={period} />
    </section>
  )
}
