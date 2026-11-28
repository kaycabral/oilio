import { STRIPE_API_VERSION } from '@/shared/billing/stripe-api-version'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { getOrgBilling } from '@/shared/org/billing-read'
import Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleStripeEvent } from './stripe-webhook'

const WEBHOOK_SECRET = 'whsec_test_secret'
const PRO_MONTHLY = 'price_pro_monthly_test'
const ADVANCED_MONTHLY = 'price_advanced_monthly_test'

const stripe = new Stripe('sk_test_unused', { apiVersion: STRIPE_API_VERSION })

function buildEvent(type: string, object: unknown): Stripe.Event {
  const payload = JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    data: { object },
    api_version: STRIPE_API_VERSION,
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
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [id],
  )
}

async function seedStripeIndex(customerId: string, orgId: string): Promise<void> {
  await ownerPool().query(
    'INSERT INTO org_billing_stripe_index (stripe_customer_id, org_id) VALUES ($1, $2) ON CONFLICT (stripe_customer_id) DO UPDATE SET org_id = EXCLUDED.org_id',
    [customerId, orgId],
  )
}

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
    await ownerPool().query(
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

  it('checkout.session.async_payment_succeeded activates a paid boleto (same as completed)', async () => {
    await seedOrg('org-boleto')
    const periodEnd = 1_800_000_000
    const sub = buildSubscription({
      id: 'sub_boleto',
      customer: 'cus_boleto',
      orgId: 'org-boleto',
      priceId: PRO_MONTHLY,
      quantity: 2,
      status: 'active',
      periodEnd,
    })
    const event = buildEvent('checkout.session.async_payment_succeeded', {
      id: 'cs_boleto',
      object: 'checkout.session',
      client_reference_id: 'org-boleto',
      customer: 'cus_boleto',
      subscription: 'sub_boleto',
      metadata: {},
    })

    await handleStripeEvent(event, {
      retrieveSubscription: () => Promise.resolve(sub),
    })

    const billing = await getOrgBilling('org-boleto')
    expect(billing.tier).toBe('pro')
    expect(billing.status).toBe('active')
    expect(billing.unitQuantity).toBe(2)
    expect(billing.stripeSubscriptionId).toBe('sub_boleto')
  })

  it('checkout.session.async_payment_failed sets past_due (boleto expired unpaid, orgId via client_reference_id)', async () => {
    await seedOrg('org-boleto-fail')
    const event = buildEvent('checkout.session.async_payment_failed', {
      id: 'cs_boleto_fail',
      object: 'checkout.session',
      client_reference_id: 'org-boleto-fail',
      customer: 'cus_boleto_fail',
      subscription: 'sub_boleto_fail',
      metadata: {},
    })

    await handleStripeEvent(event, noRetrieve)

    const billing = await getOrgBilling('org-boleto-fail')
    expect(billing.status).toBe('past_due')
    expect(billing.tier).toBe('free')
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
    expect(billing.status).toBe('active')
    expect(billing.tier).toBe('free')
  })
})
