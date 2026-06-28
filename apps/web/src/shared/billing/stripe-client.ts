import { requireEnv } from '@cbrl/env'
import 'server-only'
import Stripe from 'stripe'

// Server-only Stripe client singleton (brief 0073). The `import 'server-only'`
// guard makes a client-side import a build error — the Stripe SDK is runtime,
// must never reach the browser bundle. NEVER re-export this from a barrel that a
// client component imports (the repo's "client must not import runtime from the
// barrel" gotcha). The pure domain (`@/domain/billing`) imports nothing from here.

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached
  // Restricted API key (rk_) preferred over a secret key — see brief 0073 / Stripe
  // best-practices. Fail-fast via @cbrl/env (no `?? 'literal'` fallback).
  cached = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    // Pin the API version so SDK upgrades never silently change behavior.
    apiVersion: '2026-06-24.dahlia',
  })
  return cached
}
