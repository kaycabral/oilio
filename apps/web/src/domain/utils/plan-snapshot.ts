import type { SubscriptionPlanSnapshot } from '../types/subscription'
import type { SubscriptionPlan } from '../types/subscription-plan'

export function buildPlanSnapshot(
  plan: SubscriptionPlan,
  overrides: { priceCents?: number; billingCycle?: SubscriptionPlan['billingCycle'] } = {},
): SubscriptionPlanSnapshot {
  const snapshot: SubscriptionPlanSnapshot = {
    planId: plan.id,
    name: plan.name,
    priceCents: overrides.priceCents ?? plan.priceCents,
    billingCycle: overrides.billingCycle ?? plan.billingCycle,
    includedItemIds: plan.includedItemIds,
    includedCategoryIds: plan.includedCategoryIds,
    usageLimit: plan.usageLimit,
  }

  if (plan.unitAllowlist) {
    snapshot.unitAllowlist = [...plan.unitAllowlist]
  }

  if (plan.allowedTimeScope) {
    const scope = plan.allowedTimeScope
    const frozen: NonNullable<SubscriptionPlanSnapshot['allowedTimeScope']> = {}
    if (scope.daysOfWeek) frozen.daysOfWeek = [...scope.daysOfWeek]
    if (scope.hourRange) frozen.hourRange = { ...scope.hourRange }
    if (typeof scope.advanceBookingDays === 'number') {
      frozen.advanceBookingDays = scope.advanceBookingDays
    }
    snapshot.allowedTimeScope = frozen
  }

  if (plan.bookingLimits) {
    const limits = plan.bookingLimits
    const frozen: NonNullable<SubscriptionPlanSnapshot['bookingLimits']> = {}
    if (typeof limits.maxPerDay === 'number') frozen.maxPerDay = limits.maxPerDay
    if (typeof limits.maxConcurrent === 'number') {
      frozen.maxConcurrent = limits.maxConcurrent
    }
    if (limits.requireCompleteBeforeNext === true) {
      frozen.requireCompleteBeforeNext = true
    }
    snapshot.bookingLimits = frozen
  }

  return snapshot
}
