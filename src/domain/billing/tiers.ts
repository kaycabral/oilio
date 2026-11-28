import { Schema } from 'effect'

export const TIERS = ['free', 'pro', 'advanced'] as const
export const Tier = Schema.Literals(TIERS)
export type Tier = typeof Tier.Type

export const BILLING_CYCLES = ['monthly', 'annual'] as const
export const BillingCycle = Schema.Literals(BILLING_CYCLES)
export type BillingCycle = typeof BillingCycle.Type

export const TIER_ORDER: readonly Tier[] = TIERS

export function tierLevel(tier: Tier): number {
  return TIER_ORDER.indexOf(tier)
}

export function isAtLeast(actual: Tier, required: Tier): boolean {
  return tierLevel(actual) >= tierLevel(required)
}
