import { type BillingCycle, type SubscriptionPlan, type WEEKDAYS } from '@/domain'
import { formatAmountFromCents } from '@cbrl/br/money'

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

export const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  sunday: 'Dom',
  monday: 'Seg',
  tuesday: 'Ter',
  wednesday: 'Qua',
  thursday: 'Qui',
  friday: 'Sex',
  saturday: 'Sáb',
}

export type LimitKind = 'unlimited' | 'count'

export function derivePlanFormDefaults(plan?: SubscriptionPlan) {
  const scope = plan?.allowedTimeScope
  const limits = plan?.bookingLimits
  return {
    limitKind: plan?.usageLimit.kind ?? 'count',
    restrictUnits: Array.isArray(plan?.unitAllowlist) && plan.unitAllowlist.length > 0,
    initialAllowlist: new Set(plan?.unitAllowlist ?? []),
    restrictDays: Array.isArray(scope?.daysOfWeek) && scope.daysOfWeek.length > 0,
    restrictHours: scope?.hourRange != null,
    restrictAdvance: typeof scope?.advanceBookingDays === 'number' && scope.advanceBookingDays > 0,
    initialDays: new Set(scope?.daysOfWeek ?? []),
    restrictBookingLimits:
      limits != null &&
      (limits.maxPerDay != null ||
        limits.maxConcurrent != null ||
        limits.requireCompleteBeforeNext === true),
    initialItemIds: new Set(plan?.includedItemIds ?? []),
    initialCategoryIds: new Set(plan?.includedCategoryIds ?? []),
    initialPrice: plan != null ? formatAmountFromCents(plan.priceCents) : '',
    initialQuantity: plan?.usageLimit.kind === 'count' ? String(plan.usageLimit.quantity) : '',
  }
}
