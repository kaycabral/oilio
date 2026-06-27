import { Schema } from 'effect'

// SaaS billing tiers — the "Plano Oilio" a Negócio subscribes to (lojista → Oilio).
// Canonical model: PRD-Monetizacao-SaaS. Distinct from the store→customer
// `SubscriptionPlan` (0043); see Linguagem § Monetização SaaS.
//
// Only the three CHARGEABLE tiers live here. The contact-sales "Rede" tier has
// no price and no checkout — it stays purely in the marketing component
// (`PricingTiers.tsx`) and is not a billing tier.
export const TIERS = ['free', 'pro', 'advanced'] as const
export const Tier = Schema.Literal(...TIERS)
export type Tier = typeof Tier.Type

// Billing cycle. `annual` = 2 months free (~17% off), shown as price/month
// billed annually via the /pricing toggle.
export const BILLING_CYCLES = ['monthly', 'annual'] as const
export const BillingCycle = Schema.Literal(...BILLING_CYCLES)
export type BillingCycle = typeof BillingCycle.Type

// Ascending tier level — index encodes "how much is unlocked". Used by guards
// (feature C) to compare tiers (`isAtLeast('pro', 'free')` → true).
export const TIER_ORDER: readonly Tier[] = TIERS

export function tierLevel(tier: Tier): number {
  return TIER_ORDER.indexOf(tier)
}

// `actual` is at least `required` in the tier hierarchy.
export function isAtLeast(actual: Tier, required: Tier): boolean {
  return tierLevel(actual) >= tierLevel(required)
}
