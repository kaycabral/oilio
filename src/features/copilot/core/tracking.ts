import { getOrgDayBoundsUtc, getTodayInOrgTz } from '@/domain'

export type PartialLabelKind = 'after-commission' | 'revenue-only'

export type GoalPeriodWindow = {
  fromIso: string
  toIso: string
  elapsedDays: number
  daysInMonth: number
}

export function resolveGoalPeriodWindow(
  period: string,
  tz: string,
  now: Date = new Date(),
): GoalPeriodWindow {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const firstDay = `${period}-01`
  const lastDay = `${period}-${String(daysInMonth).padStart(2, '0')}`
  const { startUtc: fromIso } = getOrgDayBoundsUtc(firstDay, tz)
  const { endUtc: toIso } = getOrgDayBoundsUtc(lastDay, tz)

  const today = getTodayInOrgTz(tz, now)
  const todayPeriod = today.slice(0, 7)
  let elapsedDays: number
  if (todayPeriod === period) {
    elapsedDays = Number(today.slice(8, 10))
  } else if (todayPeriod > period) {
    elapsedDays = daysInMonth
  } else {
    elapsedDays = 0
  }

  return { fromIso, toIso, elapsedDays, daysInMonth }
}

export type GoalTracking = {
  targetCents: number
  realizedCents: number
  partialLabel: PartialLabelKind
  pacePct: number
  projectionCents: number | null
  projectionPct: number | null
}

export function realizedAfterCommission(revenueCents: number, commissionCents: number): number {
  return revenueCents - commissionCents
}

export function runRateProjectionCents(
  realizedCents: number,
  elapsedDays: number,
  daysInMonth: number,
  hasSales: boolean,
): number | null {
  if (!hasSales || elapsedDays <= 0) return null
  return Math.round((realizedCents / elapsedDays) * daysInMonth)
}

export function partialLabelKind(commissionCents: number): PartialLabelKind {
  return commissionCents > 0 ? 'after-commission' : 'revenue-only'
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

export function computeGoalTracking(input: {
  targetCents: number
  revenueCents: number
  commissionCents: number
  elapsedDays: number
  daysInMonth: number
}): GoalTracking {
  const realizedCents = realizedAfterCommission(input.revenueCents, input.commissionCents)
  const hasSales = input.revenueCents > 0
  const projectionCents = runRateProjectionCents(
    realizedCents,
    input.elapsedDays,
    input.daysInMonth,
    hasSales,
  )
  return {
    targetCents: input.targetCents,
    realizedCents,
    partialLabel: partialLabelKind(input.commissionCents),
    pacePct: pct(realizedCents, input.targetCents),
    projectionCents,
    projectionPct: projectionCents === null ? null : pct(projectionCents, input.targetCents),
  }
}

export const PARTIAL_LABEL_TEXT: Record<PartialLabelKind, string> = {
  'after-commission': 'parcial (após comissão) — falta custo',
  'revenue-only': 'só receita — falta todo o custo',
}
