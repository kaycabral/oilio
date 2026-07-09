import { PARTIAL_LABEL_TEXT, type GoalTracking } from '@/features/copilot/core/tracking'

function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatPct(pct: number): string {
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

const TARGET_LABEL = 'Meta de lucro do mês'
const REALIZED_LABEL = 'Realizado'
const PARTIAL_LABEL = 'Parcialidade do realizado'
const PROJECTION_LABEL = 'Projeção de fechamento (nesse ritmo)'
const MRR_LABEL = 'MRR (observação — fora do realizado)'

export function GoalTrackingPanel({
  tracking,
  mrrCents,
}: {
  tracking: GoalTracking
  mrrCents: number
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div role="group" aria-label={TARGET_LABEL}>
          <p className="text-muted-foreground text-sm">{TARGET_LABEL}</p>
          <p className="text-2xl font-semibold">{formatCents(tracking.targetCents)}</p>
        </div>
        <div className="space-y-1">
          <div role="group" aria-label={REALIZED_LABEL}>
            <p className="text-muted-foreground text-sm">
              {REALIZED_LABEL} ({formatPct(tracking.pacePct)})
            </p>
            <p className="text-2xl font-semibold">{formatCents(tracking.realizedCents)}</p>
          </div>
          <div role="group" aria-label={PARTIAL_LABEL}>
            <p className="text-muted-foreground text-xs">
              {PARTIAL_LABEL_TEXT[tracking.partialLabel]}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t pt-3" role="group" aria-label={PROJECTION_LABEL}>
        <p className="text-muted-foreground text-sm">{PROJECTION_LABEL}</p>
        {tracking.projectionCents === null ? (
          <p className="text-lg font-medium">n/d — sem vendas ainda</p>
        ) : (
          <p className="text-lg font-medium">
            {formatCents(tracking.projectionCents)}
            {tracking.projectionPct !== null ? (
              <span className="text-muted-foreground text-sm">
                {' '}
                ({formatPct(tracking.projectionPct)} da meta)
              </span>
            ) : null}
          </p>
        )}
      </div>

      {mrrCents > 0 ? (
        <div className="border-t pt-3" role="group" aria-label={MRR_LABEL}>
          <p className="text-muted-foreground text-sm">{MRR_LABEL}</p>
          <p className="text-lg font-medium">
            {formatCents(mrrCents)}
            <span className="text-muted-foreground text-sm"> /mês recorrente</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}
