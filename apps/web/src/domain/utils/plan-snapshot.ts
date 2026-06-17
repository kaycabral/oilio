// Build a frozen SubscriptionPlanSnapshot from a SubscriptionPlan.
// Single source of truth pro freeze pattern — usado em createSubscription
// (e futuramente renewSubscription quando snapshot reset for opt-in).
//
// Por que helper em vez de conditional-spread inline: o spread chain
// aninhado é code smell (legibilidade ruim, type inference frágil,
// difícil estender com mais campos opcionais). Helper com `if`s explícitos
// torna óbvio QUAL campo é opcional e por quê.
//
// Princípio: campos opcionais ficam OMITIDOS do snapshot quando ausentes
// no plano (Firestore Admin SDK rejeita `undefined` em writes).

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

  // Spatial scope (brief 0019, Group A — AC-02). Frozen copy; plan edits
  // não retroagem.
  if (plan.unitAllowlist) {
    snapshot.unitAllowlist = [...plan.unitAllowlist]
  }

  // Temporal scope (brief 0019, Group B — AC-06). Same freeze pattern;
  // sub-fields preservados individualmente (undefined axis stays undefined).
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

  // Behavioral scope (brief 0019, Group C — AC-11). Same freeze pattern.
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
