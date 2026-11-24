import { requireEnv } from '@cbrl/env'
import 'server-only'
import Stripe from 'stripe'
import { STRIPE_API_VERSION } from './stripe-api-version'

type StripeEndpoint = Pick<Stripe.StripeConfig, 'host' | 'port' | 'protocol'>

const TEST_MODE_KEY = /^(sk|rk)_test_/

export function stripeEndpoint(secretKey: string, apiBase: string | undefined): StripeEndpoint {
  if (!apiBase) return {}
  if (!TEST_MODE_KEY.test(secretKey)) {
    throw new Error('STRIPE_API_BASE accepts only a test-mode STRIPE_SECRET_KEY')
  }
  const url = new URL(apiBase)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`STRIPE_API_BASE must be http(s), got ${url.protocol}`)
  }
  if (!url.port) throw new Error('STRIPE_API_BASE must carry an explicit port')
  return {
    host: url.hostname,
    port: Number(url.port),
    protocol: url.protocol === 'http:' ? 'http' : 'https',
  }
}

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached
  const secretKey = requireEnv('STRIPE_SECRET_KEY')
  cached = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    ...stripeEndpoint(secretKey, process.env.STRIPE_API_BASE),
  })
  return cached
}
