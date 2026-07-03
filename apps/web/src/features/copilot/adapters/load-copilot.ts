import { DEFAULT_UNIT_TIMEZONE, type Goal } from '@/domain'
import { getGoalForPeriod } from '@/features/copilot/adapters/goals.repo'
import { loadGoalActuals } from '@/features/copilot/adapters/tracking.repo'
import { currentPeriod } from '@/features/copilot/core/period'
import {
  type GoalTracking,
  computeGoalTracking,
  resolveGoalPeriodWindow,
} from '@/features/copilot/core/tracking'
import { isCapabilityLocked } from '@/features/billing/adapters/capability-lock'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { requireManagerPage } from '@/shared/org/membership'
import 'server-only'

export type CopilotPageProps = {
  period: string
  // `true` when the tier does not unlock `copilot.profit_goal` (brief 0082) —
  // the page renders the upgrade CTA instead of the Copiloto.
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
  // Owner/manager only — the Copiloto surfaces financial goal/actuals/projection
  // (brief 0045). The nav hides it from non-managers; this is the server wall.
  const ctx = await requireManagerPage()

  const orgId = ctx.membership.orgId

  // Tier gate (brief 0082): the Copiloto is a `copilot.profit_goal` capability.
  // On a tier that lacks it, return early with `locked` — the page renders the
  // upgrade CTA and none of the goal/actuals data is fetched. `period` uses the
  // default tz (the CTA does not read it).
  if (await isCapabilityLocked(orgId, 'copilot.profit_goal')) {
    return { period: currentPeriod(DEFAULT_UNIT_TIMEZONE), locked: true, hasActiveUnit: false }
  }

  const { activeUnitId, units } = await resolveActiveUnit(ctx.membership)
  // Timezone is the establishment's (PRD Identidade v2 — moved Org→Unit): the
  // Copiloto scopes to the active unit, so use its tz.
  const tz =
    (activeUnitId ? units.find((u) => u.id === activeUnitId)?.timezone : undefined) ??
    units[0]?.timezone ??
    DEFAULT_UNIT_TIMEZONE
  const period = currentPeriod(tz)
  const window = resolveGoalPeriodWindow(period, tz)

  // The Copiloto operates on the active unit only — meta · realizado · projeção
  // all scoped to it (brief 0045). No cross-unit rollup.
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
