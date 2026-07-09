import { OrgBillingConfig } from '@/domain/aggregates/org-billing/config'
import { aggregateRef } from '@/domain/effect'
import type { OrgBillingStatus, StoredOrgBilling } from '@/domain/types/org-billing'
import { tierFromPriceId } from '@/shared/billing/stripe-prices'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { emitEvent } from '@/shared/effect-bridge'
import { getOrgBilling } from '@/shared/org/billing-read'
import 'server-only'
import type Stripe from 'stripe'

const WEBHOOK_ACTOR_ID = 'system:stripe-webhook'

const HANDLED_EVENTS = new Set<Stripe.Event['type']>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
])

export function isHandledEvent(type: Stripe.Event['type']): boolean {
  return HANDLED_EVENTS.has(type)
}

async function orgIdFromCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null
  const res = await getEventStorePool().query<{ org_id: string }>(
    'SELECT org_id FROM org_billing_stripe_index WHERE stripe_customer_id = $1',
    [customerId],
  )
  return res.rows[0]?.org_id ?? null
}

function customerId(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (value === null) return null
  return typeof value === 'string' ? value : value.id
}

function toIso(epochSeconds: number | null | undefined): string | null {
  if (epochSeconds === null || epochSeconds === undefined) return null
  return new Date(epochSeconds * 1000).toISOString()
}

function mapStatus(status: Stripe.Subscription.Status): OrgBillingStatus {
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

function fieldsFromSubscription(sub: Stripe.Subscription): Partial<StoredOrgBilling> {
  const item = sub.items.data[0]
  const priceId = item?.price.id
  const resolved = priceId ? tierFromPriceId(priceId) : null

  const fields: Partial<StoredOrgBilling> = {
    status: mapStatus(sub.status),
    stripeCustomerId: customerId(sub.customer),
    stripeSubscriptionId: sub.id,
    unitQuantity: item?.quantity ?? 1,
    currentPeriodEnd: toIso(item?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
  if (resolved) {
    fields.tier = resolved.tier
    fields.billingCycle = resolved.cycle
  }
  return fields
}

async function emitUpdate(
  orgId: string,
  tag: 'org_billing.updated' | 'org_billing.canceled',
  changes: Partial<StoredOrgBilling>,
): Promise<void> {
  const res = await emitEvent(OrgBillingConfig, aggregateRef(OrgBillingConfig, orgId, orgId), {
    _tag: tag,
    actorId: WEBHOOK_ACTOR_ID,
    payload: { changes: { ...changes, id: orgId, orgId } },
  })
  if (!res.ok) throw new Error(`org_billing ${tag} failed for ${orgId}: ${res.error}`)
}

async function handleSubscriptionChange(
  sub: Stripe.Subscription,
  tag: 'org_billing.updated' | 'org_billing.canceled',
): Promise<void> {
  const orgId = sub.metadata.orgId || (await orgIdFromCustomer(customerId(sub.customer)))
  if (!orgId) return
  const changes = fieldsFromSubscription(sub)
  if (tag === 'org_billing.canceled') {
    changes.tier = 'free'
    changes.status = 'canceled'
  }
  await emitUpdate(orgId, tag, changes)
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>,
): Promise<void> {
  const orgId =
    session.client_reference_id ||
    session.metadata?.orgId ||
    (await orgIdFromCustomer(customerId(session.customer)))
  if (!orgId) return

  const subId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (!subId) return

  const sub = await retrieveSubscription(subId)
  const existing = await getOrgBilling(orgId)
  const sub_fields = fieldsFromSubscription(sub)

  const data: StoredOrgBilling = {
    ...existing,
    ...sub_fields,
    id: orgId,
    orgId,
    tier: sub_fields.tier ?? existing.tier,
    billingCycle: sub_fields.billingCycle ?? existing.billingCycle,
    status: sub_fields.status ?? 'active',
    stripeCustomerId: sub_fields.stripeCustomerId ?? existing.stripeCustomerId,
  }

  const res = await emitEvent(OrgBillingConfig, aggregateRef(OrgBillingConfig, orgId, orgId), {
    _tag: 'org_billing.activated',
    actorId: WEBHOOK_ACTOR_ID,
    payload: { data },
  })
  if (!res.ok) throw new Error(`org_billing.activated failed for ${orgId}: ${res.error}`)
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const orgId = await orgIdFromCustomer(customerId(invoice.customer))
  if (!orgId) return
  await emitUpdate(orgId, 'org_billing.updated', { status: 'past_due' })
}

async function orgIdFromSession(session: Stripe.Checkout.Session): Promise<string | null> {
  return (
    session.client_reference_id ||
    session.metadata?.orgId ||
    (await orgIdFromCustomer(customerId(session.customer)))
  )
}

async function handleAsyncPaymentFailed(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = await orgIdFromSession(session)
  if (!orgId) return
  await emitUpdate(orgId, 'org_billing.updated', { status: 'past_due' })
}

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: { retrieveSubscription: (id: string) => Promise<Stripe.Subscription> },
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await handleCheckoutCompleted(event.data.object, deps.retrieveSubscription)
      return
    case 'checkout.session.async_payment_failed':
      await handleAsyncPaymentFailed(event.data.object)
      return
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionChange(event.data.object, 'org_billing.updated')
      return
    case 'customer.subscription.deleted':
      await handleSubscriptionChange(event.data.object, 'org_billing.canceled')
      return
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object)
      return
    default:
      return
  }
}
