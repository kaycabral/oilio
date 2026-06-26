import { DEFAULT_UNIT_TIMEZONE, type Goal } from '@/domain'
import { getGoalForPeriod } from '@/features/copilot/adapters/goals.repo'
import { loadGoalActuals } from '@/features/copilot/adapters/tracking.repo'
import { currentPeriod } from '@/features/copilot/core/period'
import {
  type GoalTracking,
  computeGoalTracking,
  resolveGoalPeriodWindow,
} from '@/features/copilot/core/tracking'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

export type CopilotPageProps = {
  period: string
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
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const orgId = ctx.membership.orgId
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
    return { period, hasActiveUnit: false }
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
    hasActiveUnit: true,
    unitId: activeUnitId,
    goal,
    tracking,
    mrrCents: actuals.mrrCents,
  }
}
