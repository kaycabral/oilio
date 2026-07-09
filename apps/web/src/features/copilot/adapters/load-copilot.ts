import { DEFAULT_UNIT_TIMEZONE, type Goal } from '@/domain'
import { isCapabilityLocked } from '@/features/billing/adapters/capability-lock'
import { getGoalForPeriod } from '@/features/copilot/adapters/goals.repo'
import { loadGoalActuals } from '@/features/copilot/adapters/tracking.repo'
import { currentPeriod } from '@/features/copilot/core/period'
import {
  type GoalTracking,
  computeGoalTracking,
  resolveGoalPeriodWindow,
} from '@/features/copilot/core/tracking'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { requireManagerPage } from '@/shared/org/membership'
import 'server-only'

export type CopilotPageProps = {
  period: string
  locked: boolean
} & (
  | { hasActiveUnit: false }
  | {
      hasActiveUnit: true
      unitId: string
      goal: Goal | null
      tracking: GoalTracking | null
      mrrCents: number
    }
)

export async function loadCopilotPage(): Promise<CopilotPageProps> {
  const ctx = await requireManagerPage()

  const orgId = ctx.membership.orgId

  if (await isCapabilityLocked(orgId, 'copilot.profit_goal')) {
    return { period: currentPeriod(DEFAULT_UNIT_TIMEZONE), locked: true, hasActiveUnit: false }
  }

  const { activeUnitId, units } = await resolveActiveUnit(ctx.membership)
  const tz =
    (activeUnitId ? units.find((u) => u.id === activeUnitId)?.timezone : undefined) ??
    units[0]?.timezone ??
    DEFAULT_UNIT_TIMEZONE
  const period = currentPeriod(tz)
  const window = resolveGoalPeriodWindow(period, tz)

  if (activeUnitId === null) {
    return { period, locked: false, hasActiveUnit: false }
  }

  const [goal, actuals] = await Promise.all([
    getGoalForPeriod(orgId, 'profit', activeUnitId, period),
    loadGoalActuals(orgId, activeUnitId, window),
  ])
  const tracking = goal
    ? computeGoalTracking({
        targetCents: goal.targetCents,
        revenueCents: actuals.revenueCents,
        commissionCents: actuals.commissionCents,
        elapsedDays: window.elapsedDays,
        daysInMonth: window.daysInMonth,
      })
    : null

  return {
    period,
    locked: false,
    hasActiveUnit: true,
    unitId: activeUnitId,
    goal,
    tracking,
    mrrCents: actuals.mrrCents,
  }
}
