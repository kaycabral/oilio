import { Card, CardContent, CardDescription, CardTitle, cn } from '@cbrl/design'

export type KpiCardProps = {
  label: string
  formattedValue: string
  previousFormatted?: string | null
  deltaPct?: number | null
  goodIfUp?: boolean
}

function deltaTone(pct: number | null | undefined, goodIfUp: boolean): string {
  if (pct === null || pct === undefined || pct === 0) return 'text-muted-foreground'
  const positive = pct > 0
  const good = positive === goodIfUp
  return good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

function formatDelta(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '—'
  if (pct === 0) return '0%'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function KpiCard({
  label,
  formattedValue,
  previousFormatted,
  deltaPct,
  goodIfUp = true,
}: KpiCardProps) {
  const showComparison = previousFormatted !== null && previousFormatted !== undefined
  return (
    <Card>
      <CardContent className="pt-6">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="mt-2 text-3xl">{formattedValue}</CardTitle>
        {showComparison ? (
          <div className="mt-2 flex items-baseline gap-2 text-xs">
            <span className={cn('font-medium', deltaTone(deltaPct, goodIfUp))}>
              {formatDelta(deltaPct)}
            </span>
            <span className="text-muted-foreground">vs {previousFormatted}</span>
          </div>
        ) : (
          <div className="text-muted-foreground mt-2 text-xs">Snapshot atual</div>
        )}
      </CardContent>
    </Card>
  )
}

const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatCents(cents: number): string {
  return BRL_FMT.format(cents / 100)
}

export function formatCount(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function formatPercent(pct: number): string {
  return `${pct.toFixed(1).replace('.', ',')}%`
}

export function deltaPctFor(current: number, previous: number | null): number | null {
  if (previous === null) return null
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}
