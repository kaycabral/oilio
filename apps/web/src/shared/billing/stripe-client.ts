import { requireEnv } from '@cbrl/env'
import 'server-only'
import Stripe from 'stripe'

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached
  cached = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    apiVersion: '2026-08-26.dahlia',
  })
  return cached
}
