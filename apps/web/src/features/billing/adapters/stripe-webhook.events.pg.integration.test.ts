import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { getOrgBilling } from '@/shared/org/billing-read'
import Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleStripeEvent } from './stripe-webhook'

/**
 * Webhook dispatch proof against REAL Postgres (brief 0074, AC-03). Feeds
 * `handleStripeEvent` genuine `Stripe.Event` objects — built by SIGNING a JSON
 * payload with a test secret and round-tripping it through
 * `stripe.webhooks.constructEvent`, so the events are fully typed with zero casts
 * — and asserts the resulting `org_billing` row state via `getOrgBilling`.
 *
 * Covers: checkout.session.completed → activated; subscription.updated → status/
 * period/quantity/cancel; subscription.deleted → back to free; payment_failed →
 * past_due. orgId resolved BOTH via metadata/client_reference_id AND via the
 * non-RLS stripe index fallback.
 */

const WEBHOOK_SECRET = 'whsec_test_secret'
const PRO_MONTHLY = 'price_pro_monthly_test'
const ADVANCED_MONTHLY = 'price_advanced_monthly_test'

// A throwaway Stripe instance just to sign/parse payloads — no network. The key
// is irrelevant for webhook construction (it's offline HMAC).
const stripe = new Stripe('sk_test_unused', { apiVersion: '2026-06-24.dahlia' })

// Sign a payload and round-trip it into a real, fully-typed Stripe.Event.
function buildEvent(type: string, object: unknown): Stripe.Event {
  const payload = JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    data: { object },
    api_version: '2026-06-24.dahlia',
  })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  return stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET)
}

type SubscriptionOpts = {
  id: string
  customer: string
  orgId?: string
  priceId: string
  quantity: number
  status: string
  periodEnd: number
  cancelAtPeriodEnd?: boolean
}

function subscriptionObject(opts: SubscriptionOpts): unknown {
  return {
    id: opts.id,
    object: 'subscription',
    customer: opts.customer,
    status: opts.status,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    metadata: opts.orgId ? { orgId: opts.orgId } : {},
    items: {
      object: 'list',
      data: [
        {
          id: `si_${opts.id}`,
          object: 'subscription_item',
          quantity: opts.quantity,
          current_period_end: opts.periodEnd,
          current_period_start: opts.periodEnd - 2_592_000,
          price: { id: opts.priceId, object: 'price' },
        },
      ],
    },
  }
}

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [id],
  )
}

async function seedStripeIndex(customerId: string, orgId: string): Promise<void> {
  await getEventStorePool().query(
    'INSERT INTO org_billing_stripe_index (stripe_customer_id, org_id) VALUES ($1, $2) ON CONFLICT (stripe_customer_id) DO UPDATE SET org_id = EXCLUDED.org_id',
    [customerId, orgId],
  )
}

// Build a real, fully-typed Stripe.Subscription by round-tripping through a
// signed event — the discriminated union narrows `data.object` to Subscription,
// so no cast is needed.
function buildSubscription(opts: SubscriptionOpts): Stripe.Subscription {
  const event = buildEvent('customer.subscription.updated', subscriptionObject(opts))
  if (event.type !== 'customer.subscription.updated') throw new Error('unreachable')
  return event.data.object
}

const noRetrieve = {
  retrieveSubscription: () => Promise.reject(new Error('should not retrieve')),
}

describe('Stripe webhook dispatch → org_billing (brief 0074, AC-03)', () => {
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_PRICE_PRO_MONTHLY = PRO_MONTHLY
    process.env.STRIPE_PRICE_PRO_ANNUAL = 'price_pro_annual_test'
    process.env.STRIPE_PRICE_ADVANCED_MONTHLY = ADVANCED_MONTHLY
    process.env.STRIPE_PRICE_ADVANCED_ANNUAL = 'price_advanced_annual_test'
  })

  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE stripe_webhook_events, org_billing_stripe_index, org_billing, orgs, events CASCADE',
    )
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('checkout.session.completed activates the Pro plan (orgId via client_reference_id)', async () => {
    await seedOrg('org-checkout')
    const periodEnd = 1_800_000_000
    const sub = buildSubscription({
      id: 'sub_1',
      customer: 'cus_1',
      orgId: 'org-checkout',
      priceId: PRO_MONTHLY,
      quantity: 3,
      status: 'active',
      periodEnd,
    })
    const event = buildEvent('checkout.session.completed', {
      id: 'cs_1',
      object: 'checkout.session',
      client_reference_id: 'org-checkout',
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: {},
    })

    await handleStripeEvent(event, {
      retrieveSubscription: () => Promise.resolve(sub),
    })

    const billing = await getOrgBilling('org-checkout')
    expect(billing.tier).toBe('pro')
    expect(billing.status).toBe('active')
    expect(billing.billingCycle).toBe('monthly')
    expect(billing.unitQuantity).toBe(3)
    expect(billing.stripeCustomerId).toBe('cus_1')
    expect(billing.stripeSubscriptionId).toBe('sub_1')
    expect(billing.currentPeriodEnd).toBe(new Date(periodEnd * 1000).toISOString())
  })

  it('customer.subscription.created activates a sub born outside checkout (portal path)', async () => {
    await seedOrg('org-created')
    const event = buildEvent(
      'customer.subscription.created',
      subscriptionObject({
        id: 'sub_created',
        customer: 'cus_created',
        orgId: 'org-created',
        priceId: PRO_MONTHLY,
        quantity: 1,
        status: 'active',
        periodEnd: 1_900_000_000,
      }),
    )

    await handleStripeEvent(event, noRetrieve)

    const billing = await getOrgBilling('org-created')
    expect(billing.tier).toBe('pro')
    expect(billing.status).toBe('active')
    expect(billing.stripeSubscriptionId).toBe('sub_created')
  })

  it('customer.subscription.updated mirrors status, quantity, period, cancel (orgId via metadata)', async () => {
    await seedOrg('org-upd')
    const periodEnd = 1_900_000_000
    const event = buildEvent(
      'customer.subscription.updated',
      subscriptionObject({
        id: 'sub_2',
        customer: 'cus_2',
        orgId: 'org-upd',
        priceId: ADVANCED_MONTHLY,
        quantity: 5,
        status: 'active',
        periodEnd,
        cancelAtPeriodEnd: true,
      }),
    )

    await handleStripeEvent(event, noRetrieve)

    const billing = await getOrgBilling('org-upd')
    expect(billing.tier).toBe('advanced')
    expect(billing.unitQuantity).toBe(5)
    expect(billing.cancelAtPeriodEnd).toBe(true)
    expect(billing.currentPeriodEnd).toBe(new Date(periodEnd * 1000).toISOString())
  })

  it('customer.subscription.deleted drops the plan back to free', async () => {
    await seedOrg('org-del')
    // First activate, then delete.
    await handleStripeEvent(
      buildEvent(
        'customer.subscription.updated',
        subscriptionObject({
          id: 'sub_3',
          customer: 'cus_3',
          orgId: 'org-del',
          priceId: PRO_MONTHLY,
          quantity: 2,
          status: 'active',
          periodEnd: 1_900_000_000,
        }),
      ),
      noRetrieve,
    )
    expect((await getOrgBilling('org-del')).tier).toBe('pro')

    await handleStripeEvent(
      buildEvent(
        'customer.subscription.deleted',
        subscriptionObject({
          id: 'sub_3',
          customer: 'cus_3',
          orgId: 'org-del',
          priceId: PRO_MONTHLY,
          quantity: 2,
          status: 'canceled',
          periodEnd: 1_900_000_000,
        }),
      ),
      noRetrieve,
    )

    const billing = await getOrgBilling('org-del')
    expect(billing.tier).toBe('free')
    expect(billing.status).toBe('canceled')
  })

  it('invoice.payment_failed sets past_due, resolving orgId via the non-RLS index', async () => {
    await seedOrg('org-fail')
    await seedStripeIndex('cus_4', 'org-fail')
    // Seed an active Pro so we can see the status flip without losing the tier.
    await handleStripeEvent(
      buildEvent(
        'customer.subscription.updated',
        subscriptionObject({
          id: 'sub_4',
          customer: 'cus_4',
          orgId: 'org-fail',
          priceId: PRO_MONTHLY,
          quantity: 1,
          status: 'active',
          periodEnd: 1_900_000_000,
        }),
      ),
      noRetrieve,
    )

    const event = buildEvent('invoice.payment_failed', {
      id: 'in_1',
      object: 'invoice',
      customer: 'cus_4',
    })
    await handleStripeEvent(event, noRetrieve)

    const billing = await getOrgBilling('org-fail')
    expect(billing.status).toBe('past_due')
    expect(billing.tier).toBe('pro')
  })

  it('an unknown price id leaves the tier unchanged (foreign Stripe object)', async () => {
    await seedOrg('org-unknown')
    const event = buildEvent(
      'customer.subscription.updated',
      subscriptionObject({
        id: 'sub_5',
        customer: 'cus_5',
        orgId: 'org-unknown',
        priceId: 'price_not_ours',
        quantity: 1,
        status: 'active',
        periodEnd: 1_900_000_000,
      }),
    )

    await handleStripeEvent(event, noRetrieve)

    const billing = await getOrgBilling('org-unknown')
    // Status/quantity still mirror, but tier stays free (price not recognized).
    expect(billing.status).toBe('active')
    expect(billing.tier).toBe('free')
  })
})
