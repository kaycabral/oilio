// Pure read-model for the Copiloto tracking (brief 0042, #1115). Computes
// realizado-após-comissão, ritmo and run-rate projection against the goal — all
// derived live from order/commission projections, NO event emitted (read-only).
// Kept pure + injectable so the degenerate cases (no sales, no commission) are
// unit-testable without the emulator.

import { getOrgDayBoundsUtc, getTodayInOrgTz } from '@/domain'

export type PartialLabelKind = 'after-commission' | 'revenue-only'

export type GoalPeriodWindow = {
  fromIso: string
  toIso: string
  elapsedDays: number
  daysInMonth: number
}

// Resolve the UTC window + elapsed/total days for a `YYYY-MM` period in the
// org timezone. Pure + injectable clock (unit-testable run-rate inputs).
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
  // Resultado-após-comissão (partial — cost isn't modeled yet).
  realizedCents: number
  // `after-commission`: there was commission to subtract → "falta custo".
  // `revenue-only`: no commission at all (SaaS / produto-puro) → "só receita".
  partialLabel: PartialLabelKind
  // Realizado as a % of the target (0..∞, 1 decimal).
  pacePct: number
  // Run-rate close projection; null = n/d (no sales to extrapolate / no day
  // elapsed) so the UI never divides by zero nor fakes a closing number.
  projectionCents: number | null
  projectionPct: number | null
}

export function realizedAfterCommission(revenueCents: number, commissionCents: number): number {
  return revenueCents - commissionCents
}

// Linear run-rate: realizado / dias_decorridos × dias_no_mês. Returns null
// (n/d) when there are no sales (nothing to extrapolate) or no day has elapsed
// (avoids ÷0) — AC-05.
export function runRateProjectionCents(
  realizedCents: number,
  elapsedDays: number,
  daysInMonth: number,
  hasSales: boolean,
): number | null {
  if (!hasSales || elapsedDays <= 0) return null
  return Math.round((realizedCents / elapsedDays) * daysInMonth)
}

// AC-06: the label keys off whether any commission was subtracted. If none,
// the realizado IS pure revenue, so "só receita" is the honest label.
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
