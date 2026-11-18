'use client'

import type { TrendPoint } from '@/features/dashboard/core/trend'
import { Card, CardContent, CardDescription, CardTitle } from '@oilio/design'
import { useMemo, useRef, useState } from 'react'
import { formatCents, formatCount } from './KpiCard'

export type TrendChartProps = {
  points: TrendPoint[]
}

const BRL_NUMBER = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

const VB_WIDTH = 800
const VB_HEIGHT = 240
const PADDING_LEFT = 56
const PADDING_RIGHT = 56
const PADDING_TOP = 16
const PADDING_BOTTOM = 32

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const scaled = value / magnitude
  const nice = niceMultiple(scaled)
  return nice * magnitude
}

function niceMultiple(scaled: number): number {
  if (scaled <= 1) return 1
  if (scaled <= 2) return 2
  if (scaled <= 5) return 5
  return 10
}

function formatShortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

function formatFullDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

export function TrendChart({ points }: TrendChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const { revenueMax, subsMax, xs, revenueYs, subsYs } = useMemo(() => {
    const revMaxRaw = Math.max(0, ...points.map((p) => p.revenueCents))
    const subsMaxRaw = Math.max(0, ...points.map((p) => p.newSubs))
    const rMax = niceMax(revMaxRaw)
    const sMax = niceMax(subsMaxRaw)

    const innerW = VB_WIDTH - PADDING_LEFT - PADDING_RIGHT
    const innerH = VB_HEIGHT - PADDING_TOP - PADDING_BOTTOM
    const n = points.length
    const step = n > 1 ? innerW / (n - 1) : 0
    const xs = points.map((_, i) => PADDING_LEFT + i * step)
    const yScale = (v: number, max: number) =>
      max === 0 ? PADDING_TOP + innerH : PADDING_TOP + innerH - (v / max) * innerH
    const revenueYs = points.map((p) => yScale(p.revenueCents, rMax))
    const subsYs = points.map((p) => yScale(p.newSubs, sMax))
    return { revenueMax: rMax, subsMax: sMax, xs, revenueYs, subsYs }
  }, [points])

  const totalRevenue = points.reduce((acc, p) => acc + p.revenueCents, 0)
  const totalSubs = points.reduce((acc, p) => acc + p.newSubs, 0)

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg || points.length === 0) return
    const rect = svg.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    const xCoord = ratio * VB_WIDTH
    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i]! - xCoord)
      if (d < nearestDist) {
        nearestDist = d
        nearest = i
      }
    }
    setHoverIdx(nearest)
  }

  const revenuePath = pointsToPath(xs, revenueYs)
  const subsPath = pointsToPath(xs, subsYs)

  const tickIdxs = computeTickIdxs(points.length)

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <CardDescription>Tendência diária</CardDescription>
            <CardTitle className="mt-1 text-lg">Faturamento × novos assinantes</CardTitle>
          </div>
          <div className="flex gap-4 text-xs">
            <Legend swatch="bg-emerald-500" label={`Faturamento (${formatCents(totalRevenue)})`} />
            <Legend swatch="bg-sky-500" label={`Novos assinantes (${formatCount(totalSubs)})`} />
          </div>
        </div>

        {points.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            Sem dados no período.
          </div>
        ) : (
          <div className="relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
              className="h-[240px] w-full touch-none"
              role="img"
              aria-label="Gráfico de tendência diária"
              onPointerMove={handleMove}
              onPointerLeave={() => setHoverIdx(null)}
            >
              <AxisLabels
                side="left"
                max={revenueMax}
                formatter={(v) => `R$ ${BRL_NUMBER.format(Math.round(v / 100))}`}
              />
              <AxisLabels side="right" max={subsMax} formatter={(v) => `${Math.round(v)}`} />
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const y = PADDING_TOP + (1 - frac) * (VB_HEIGHT - PADDING_TOP - PADDING_BOTTOM)
                return (
                  <line
                    key={frac}
                    x1={PADDING_LEFT}
                    x2={VB_WIDTH - PADDING_RIGHT}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-border"
                    strokeOpacity={frac === 0 ? 0.5 : 0.2}
                  />
                )
              })}

              <path
                d={revenuePath}
                fill="none"
                stroke="currentColor"
                className="text-emerald-500"
                strokeWidth={2}
              />
              <path
                d={subsPath}
                fill="none"
                stroke="currentColor"
                className="text-sky-500"
                strokeWidth={2}
              />

              {tickIdxs.map((i) => (
                <text
                  key={i}
                  x={xs[i]}
                  y={VB_HEIGHT - PADDING_BOTTOM + 18}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatShortDate(points[i]!.date)}
                </text>
              ))}

              {hoverIdx !== null ? (
                <>
                  <line
                    x1={xs[hoverIdx]}
                    x2={xs[hoverIdx]}
                    y1={PADDING_TOP}
                    y2={VB_HEIGHT - PADDING_BOTTOM}
                    stroke="currentColor"
                    className="text-foreground"
                    strokeOpacity={0.3}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={xs[hoverIdx]}
                    cy={revenueYs[hoverIdx]}
                    r={4}
                    className="fill-emerald-500"
                  />
                  <circle cx={xs[hoverIdx]} cy={subsYs[hoverIdx]} r={4} className="fill-sky-500" />
                </>
              ) : null}
            </svg>

            {hoverIdx !== null ? (
              <TrendTooltip point={points[hoverIdx]!} xRatio={xs[hoverIdx]! / VB_WIDTH} />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`block h-2 w-2 rounded-full ${swatch}`} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

function pointsToPath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return ''
  let d = `M ${xs[0]} ${ys[0]}`
  for (let i = 1; i < xs.length; i++) d += ` L ${xs[i]} ${ys[i]}`
  return d
}

function computeTickIdxs(n: number): number[] {
  if (n <= 1) return n === 1 ? [0] : []
  if (n <= 6) return Array.from({ length: n }, (_, i) => i)
  const step = Math.max(1, Math.round((n - 1) / 5))
  const set = new Set<number>()
  for (let i = 0; i < n; i += step) set.add(i)
  set.add(n - 1)
  return Array.from(set).sort((a, b) => a - b)
}

function AxisLabels({
  side,
  max,
  formatter,
}: {
  side: 'left' | 'right'
  max: number
  formatter: (v: number) => string
}) {
  const fracs = [0, 0.5, 1]
  return (
    <>
      {fracs.map((frac) => {
        const y = PADDING_TOP + (1 - frac) * (VB_HEIGHT - PADDING_TOP - PADDING_BOTTOM)
        const value = frac * max
        return (
          <text
            key={frac}
            x={side === 'left' ? PADDING_LEFT - 6 : VB_WIDTH - PADDING_RIGHT + 6}
            y={y + 3}
            textAnchor={side === 'left' ? 'end' : 'start'}
            className="fill-muted-foreground text-[10px]"
          >
            {formatter(value)}
          </text>
        )
      })}
    </>
  )
}

function TrendTooltip({ point, xRatio }: { point: TrendPoint; xRatio: number }) {
  const leftSide = xRatio > 0.6
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none absolute top-2 z-10 rounded-md border px-3 py-2 text-xs shadow-md"
      style={leftSide ? { left: 12 } : { right: 12 }}
      role="tooltip"
    >
      <div className="text-muted-foreground mb-1">{formatFullDate(point.date)}</div>
      <div className="flex items-center gap-2">
        <span className="block h-2 w-2 rounded-full bg-emerald-500" />
        <span>Faturamento: {formatCents(point.revenueCents)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="block h-2 w-2 rounded-full bg-sky-500" />
        <span>Novos assinantes: {formatCount(point.newSubs)}</span>
      </div>
    </div>
  )
}
