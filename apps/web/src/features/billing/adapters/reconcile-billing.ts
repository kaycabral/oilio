import { syncStripeSubscriptionQuantity } from '@/shared/billing/stripe-sync'
import { getEventStorePool } from '@/shared/db/pg/pool'
import 'server-only'

async function orgIdsWithSubscription(): Promise<string[]> {
  const res = await getEventStorePool().query<{ org_id: string }>(
    "SELECT org_id FROM org_billing WHERE stripe_subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due')",
  )
  return res.rows.map((r) => r.org_id)
}

export async function reconcileBillingQuantities(): Promise<number> {
  const orgIds = await orgIdsWithSubscription()
  for (const orgId of orgIds) {
    await syncStripeSubscriptionQuantity(orgId)
  }
  return orgIds.length
}
