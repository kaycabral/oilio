import type { BillingCycle, Tier } from '@/domain/billing/tiers'
import { requireEnv } from '@cbrl/env'
import 'server-only'

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

export function stripePriceId(tier: Tier, cycle: BillingCycle): string | null {
  if (!isChargeableTier(tier)) return null
  return requireEnv(PRICE_ENV[tier][cycle])
}

export function tierFromPriceId(priceId: string): { tier: Tier; cycle: BillingCycle } | null {
  for (const tier of ['pro', 'advanced'] as const) {
    for (const cycle of ['monthly', 'annual'] as const) {
      if (requireEnv(PRICE_ENV[tier][cycle]) === priceId) return { tier, cycle }
    }
  }
  return null
}
