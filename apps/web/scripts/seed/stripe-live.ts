// Live-Stripe billing for the seed (brief 0090 smoke). When a Stripe TEST secret
// is present, the showcase org gets a REAL subscription in the connected test
// account — customer, default card, active subscription and a paid invoice — so
// the Cobrança panel shows the payment method, the invoice table and the native
// cancellation zone exactly as production would. Without a test key (CI, offline
// seed) the caller falls back to the tier-only projection.
//
// The projected fields are derived the SAME way the webhook derives them
// (`fieldsFromSubscription` in features/billing/adapters/stripe-webhook.ts):
// tier/cycle from the price id, `currentPeriodEnd` from the subscription ITEM
// (not the subscription), status via the same mapping. Emitting them through the
// canonical `org_billing.activated` event also populates the
// `org_billing_stripe_index` (customerId → orgId) via the projector, so a real
// webhook could resolve this org by customer.

import type { BillingCycle, Tier } from '@/domain/billing/tiers'
import Stripe from 'stripe'

const API_VERSION = '2026-06-24.dahlia'

// The env var holding each chargeable tier+cycle's Stripe Price id. Mirrors
// `PRICE_ENV` in shared/billing/stripe-prices.ts — kept inline because that
// module is `server-only` and can't be imported from the seed (a tsx script).
const PRICE_ENV: Record<Exclude<Tier, 'free'>, Record<BillingCycle, string>> = {
  pro: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', annual: 'STRIPE_PRICE_PRO_ANNUAL' },
  advanced: { monthly: 'STRIPE_PRICE_ADVANCED_MONTHLY', annual: 'STRIPE_PRICE_ADVANCED_ANNUAL' },
}

function seedPriceId(tier: Exclude<Tier, 'free'>, cycle: BillingCycle): string | null {
  return process.env[PRICE_ENV[tier][cycle]] ?? null
}

// Stripe's canonical test card (Visa 4242) as a ready-made PaymentMethod token —
// no raw PAN handling. Yields brand "visa", last4 "4242" on the seeded card.
const TEST_PAYMENT_METHOD = 'pm_card_visa'

export type LiveBillingFields = {
  status: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  billingCycle: BillingCycle
  unitQuantity: number
}

// The Stripe TEST secret we may write to, or null when absent / not a test key.
// We deliberately refuse anything that isn't clearly a test/restricted-test key,
// so a mis-set live key can never mint real customers from the seed.
function stripeTestKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY ?? null
  if (key && (key.startsWith('sk_test_') || key.startsWith('rk_test_'))) return key
  return null
}

// True when a usable Stripe TEST secret is present (the caller then activates a
// real subscription; otherwise it falls back to the tier-only projection).
export function hasStripeTestKey(): boolean {
  return stripeTestKey() !== null
}

function mapStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
      return 'past_due'
    case 'canceled':
    case 'unpaid':
      return 'canceled'
    default:
      return 'incomplete'
  }
}

function toIso(epochSeconds: number | null | undefined): string | null {
  return typeof epochSeconds === 'number' ? new Date(epochSeconds * 1000).toISOString() : null
}

// Removes any test customer previously seeded for this org, so a re-run doesn't
// pile up subscriptions/customers in the test account. Test mode only.
async function purgePriorCustomers(stripe: Stripe, orgId: string): Promise<void> {
  const existing = await stripe.customers.search({
    query: `metadata['orgId']:'${orgId}'`,
    limit: 100,
  })
  for (const customer of existing.data) {
    await stripe.customers.del(customer.id)
  }
}

// Creates a real active subscription in the Stripe TEST account for `orgId` and
// returns the fields to project into org_billing. Throws on any Stripe failure —
// a seed must fail loudly, and the caller only invokes this when a test key is
// present.
export async function activateBillingViaStripe(args: {
  orgId: string
  orgName: string
  tier: Exclude<Tier, 'free'>
  cycle: BillingCycle
  unitQuantity: number
}): Promise<LiveBillingFields> {
  const { orgId, orgName, tier, cycle, unitQuantity } = args
  const priceId = seedPriceId(tier, cycle)
  if (!priceId) throw new Error(`no Stripe price for ${tier}/${cycle} — check STRIPE_PRICE_* env`)

  const secret = stripeTestKey()
  if (!secret) throw new Error('activateBillingViaStripe called without a Stripe TEST key')
  const stripe = new Stripe(secret, { apiVersion: API_VERSION })

  await purgePriorCustomers(stripe, orgId)

  // Customer carries `metadata.orgId` (mirrors checkout.actions) + the default
  // card, so it's the payer of record.
  const customer = await stripe.customers.create({
    name: orgName,
    metadata: { orgId },
    payment_method: TEST_PAYMENT_METHOD,
    invoice_settings: { default_payment_method: TEST_PAYMENT_METHOD },
  })

  // Active subscription with the graduated per-unit price. `metadata.orgId` lets
  // a real webhook resolve the org (same as checkout's subscription_data). The
  // default test card charges the first invoice immediately → status "active".
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId, quantity: unitQuantity }],
    metadata: { orgId },
    // Expand the item's period end (SDK 22.x moved current_period_end onto the
    // item) and the latest invoice, matching what the webhook reads.
    expand: ['items.data', 'latest_invoice'],
  })

  const item = subscription.items.data[0]
  return {
    status: mapStatus(subscription.status),
    stripeCustomerId: customer.id,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: toIso(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    billingCycle: cycle,
    unitQuantity: item?.quantity ?? unitQuantity,
  }
}
