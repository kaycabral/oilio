import { OrgBillingConfig } from '@/domain/aggregates/org-billing/config'
import { aggregateRef } from '@/domain/effect'
import type { OrgBillingStatus, StoredOrgBilling } from '@/domain/types/org-billing'
import { tierFromPriceId } from '@/shared/billing/stripe-prices'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { emitEvent } from '@/shared/effect-bridge'
import { getOrgBilling } from '@/shared/org/billing-read'
import 'server-only'
import type Stripe from 'stripe'

// Stripe webhook dispatch (brief 0074, AC-03). Maps each handled Stripe event to
// exactly one org_billing event via emitEvent. The write is RLS-safe without a
// session: emitEvent sets the GUC `app.current_org` from `ref.orgId`, so the
// webhook (no cookie) writes the org's own row by constructing the ref with the
// resolved orgId. Stripe is the system of record; this only mirrors its ledger.

// Stripe is webhook actor: there is no human session behind these writes. A
// stable synthetic actor id makes the event stream auditable as "system, via
// Stripe webhook" rather than attributing the change to a user.
const WEBHOOK_ACTOR_ID = 'system:stripe-webhook'

// The events we act on. Anything else is acknowledged (200) and ignored — Stripe
// retries only on non-2xx, so silently dropping unhandled types is correct.
const HANDLED_EVENTS = new Set<Stripe.Event['type']>([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
])

export function isHandledEvent(type: Stripe.Event['type']): boolean {
  return HANDLED_EVENTS.has(type)
}

// Resolve the Negócio an event belongs to. Primary: the orgId we stamped on the
// Stripe object at checkout (subscription.metadata / session metadata /
// client_reference_id). Fallback (events without our metadata, e.g.
// invoice.payment_failed): the non-RLS index that maps stripe_customer_id →
// org_id. Read on the raw pool — the index is public-by-contract, not org-scoped.
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

// Epoch seconds (Stripe) → ISO string (our boundary), or null. Stripe omits the
// field as undefined; org_billing stores null.
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
      // incomplete / incomplete_expired / paused — treat as not-yet-active.
      return 'incomplete'
  }
}

// Derive the org_billing fields a subscription implies. Per-unit graduated
// pricing: `unitQuantity` = the subscription item quantity Stripe is billing;
// `currentPeriodEnd` lives on the ITEM (not the subscription) in this API version.
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
  // Always carry id/orgId: a subscription.updated / payment_failed can be the
  // FIRST event for this Negócio (no prior activation), and the projection's PK
  // is org_id — the row must be born identified.
  const res = await emitEvent(OrgBillingConfig, aggregateRef(OrgBillingConfig, orgId, orgId), {
    _tag: tag,
    actorId: WEBHOOK_ACTOR_ID,
    payload: { changes: { ...changes, id: orgId, orgId } },
  })
  // Surface so the webhook returns non-2xx and Stripe retries (the idempotency
  // row is only written AFTER a successful handle — see the route).
  if (!res.ok) throw new Error(`org_billing ${tag} failed for ${orgId}: ${res.error}`)
}

async function handleSubscriptionChange(
  sub: Stripe.Subscription,
  tag: 'org_billing.updated' | 'org_billing.canceled',
): Promise<void> {
  const orgId = sub.metadata.orgId || (await orgIdFromCustomer(customerId(sub.customer)))
  if (!orgId) return
  const changes = fieldsFromSubscription(sub)
  // subscription.deleted: the plan ends — drop to free. cancel_at_period_end
  // keeps capabilities until currentPeriodEnd (the period fields above carry it).
  if (tag === 'org_billing.canceled') {
    changes.tier = 'free'
    changes.status = 'canceled'
  }
  await emitUpdate(orgId, tag, changes)
}

// checkout.session.completed: the subscription was just created. We have the
// session (orgId via client_reference_id/metadata, the customer, the
// subscription id). Retrieve the subscription to read the price/period/quantity,
// then activate.
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

  // Activation writes the full doc (org_billing.activated overwrites state). Keep
  // the existing customer id if Stripe didn't echo one on the subscription.
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

// Apply one Stripe event to org_billing. Idempotency (event.id dedup) is handled
// by the route BEFORE this runs; the reducer is also content-idempotent as a
// second layer. Throws on a write failure so the route can return non-2xx and let
// Stripe retry. `deps` injects the Stripe retrieve call so tests can stub it.
export async function handleStripeEvent(
  event: Stripe.Event,
  deps: { retrieveSubscription: (id: string) => Promise<Stripe.Subscription> },
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object, deps.retrieveSubscription)
      return
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
      // Not in HANDLED_EVENTS — acknowledged and ignored.
      return
  }
}
