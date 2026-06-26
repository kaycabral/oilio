// Pure default-derivation + label maps for the plan form, extracted from the
// 'use client' component (Functional Core / Imperative Shell) so the toggle/
// checkbox initial states and the formatted price/quantity are importable +
// unit-tested. No React, no I/O.

import { type BillingCycle, type SubscriptionPlan, type WEEKDAYS } from '@/domain'

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

// Brief 0019 Group B — weekday labels for the daysOfWeek toggle.
// Order mirrors `WEEKDAYS` (0=domingo … 6=sábado).
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

// Derive every default the form starts from off the (optional) plan being
// edited — the toggle/checkbox initial states + the formatted price/quantity.
// Each scope axis (units / days / hours / advance / booking-limits) is
// independent: a plan snapshot opts into any subset (briefs 0019/0024).
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
    initialPrice: plan != null ? (plan.priceCents / 100).toFixed(2).replace('.', ',') : '',
    initialQuantity: plan?.usageLimit.kind === 'count' ? String(plan.usageLimit.quantity) : '',
  }
}
