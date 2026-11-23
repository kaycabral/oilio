import 'server-only'

import { DEFAULT_UNIT_TIMEZONE, type FixedCost } from '@/domain'
import { firstInstantOfMonthUtc, nextMonth } from '@/domain/utils/competence-month'
import { getBreakEven } from '@/features/finance/adapters/contribution-margin.repo'
import { listActiveFixedCostsForUnit } from '@/features/finance/adapters/fixed-costs.repo'
import type { BreakEven } from '@/features/finance/core/cuts'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { requireManagerPage } from '@/shared/org/membership'

export type FinancePageProps = {
  period: string
} & (
  | { hasActiveUnit: false }
  | {
      hasActiveUnit: true
      unitId: string
      fixedCosts: FixedCost[]
      breakEven: BreakEven
    }
)

export async function loadFinancePage(): Promise<FinancePageProps> {
  const ctx = await requireManagerPage()
  const orgId = ctx.membership.orgId

  const { activeUnitId, units } = await resolveActiveUnit(ctx.membership)
  const tz =
    (activeUnitId ? units.find((u) => u.id === activeUnitId)?.timezone : undefined) ??
    units[0]?.timezone ??
    DEFAULT_UNIT_TIMEZONE
  const period = currentMonth(tz)

  if (activeUnitId === null) {
    return { period, hasActiveUnit: false }
  }

  const window = monthWindow(period, tz)
  const [fixedCosts, breakEvenCut] = await Promise.all([
    listActiveFixedCostsForUnit(orgId, activeUnitId),
    getBreakEven({ orgId, fromIso: window.fromIso, toIso: window.toIso }, activeUnitId),
  ])

  return {
    period,
    hasActiveUnit: true,
    unitId: activeUnitId,
    fixedCosts,
    breakEven: breakEvenCut,
  }
}

function currentMonth(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .slice(0, 7)
}

function monthWindow(period: string, tz: string): { fromIso: string; toIso: string } {
  return {
    fromIso: firstInstantOfMonthUtc(period, tz),
    toIso: firstInstantOfMonthUtc(nextMonth(period), tz),
  }
}
