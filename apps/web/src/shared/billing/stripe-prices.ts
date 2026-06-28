import type { BillingCycle, Tier } from '@/domain/billing/tiers'
import { requireEnv } from '@cbrl/env'
import 'server-only'

// Resolve a chargeable tier + cycle to its Stripe Price id (brief 0073). Price
// ids differ per environment (test vs live) and per cycle, so they come from env
// (fail-fast via @cbrl/env) — NOT hardcoded. The Prices themselves are created as
// GRADUATED in Stripe (1st unit base price, extra units discounted); we only pass
// `quantity` = active unit count and Stripe computes the total. Setup documented
// in docs/stripe-setup.md.
//
// Free has no Price (no Stripe object); Rede is contact-sales (no checkout). So
// only pro/advanced × monthly/annual map to a Price.

const PRICE_ENV: Record<Exclude<Tier, 'free'>, Record<BillingCycle, string>> = {
  pro: {
    monthly: 'STRIPE_PRICE_PRO_MONTHLY',
    annual: 'STRIPE_PRICE_PRO_ANNUAL',
  },
  advanced: {
    monthly: 'STRIPE_PRICE_ADVANCED_MONTHLY',
    annual: 'STRIPE_PRICE_ADVANCED_ANNUAL',
  },
}

export function isChargeableTier(tier: Tier): tier is Exclude<Tier, 'free'> {
  return tier === 'pro' || tier === 'advanced'
}

// Returns the Stripe Price id for a paid tier + cycle, or null for Free (no
// Stripe object). Throws (fail-fast) if a paid tier's env var is unset.
export function stripePriceId(tier: Tier, cycle: BillingCycle): string | null {
  if (!isChargeableTier(tier)) return null
  return requireEnv(PRICE_ENV[tier][cycle])
}
