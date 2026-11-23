import { syncStripeSubscriptionQuantity } from '@/shared/billing/stripe-sync'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { getOrgBilling } from '@/shared/org/billing-read'
import 'server-only'

const LIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due'])

async function orgIdsWithStripeCustomer(): Promise<string[]> {
  const res = await getEventStorePool().query<{ org_id: string }>(
    'SELECT DISTINCT org_id FROM org_billing_stripe_index ORDER BY org_id',
  )
  return res.rows.map((r) => r.org_id)
}

export async function reconcileBillingQuantities(): Promise<number> {
  let swept = 0
  for (const orgId of await orgIdsWithStripeCustomer()) {
    const billing = await getOrgBilling(orgId)
    if (!billing.stripeSubscriptionId || !LIVE_STATUSES.has(billing.status)) continue
    await syncStripeSubscriptionQuantity(orgId)
    swept++
  }
  return swept
}
