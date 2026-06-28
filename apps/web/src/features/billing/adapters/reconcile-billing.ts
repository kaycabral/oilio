import { syncStripeSubscriptionQuantity } from '@/shared/billing/stripe-sync'
import { getEventStorePool } from '@/shared/db/pg/pool'
import 'server-only'

// Billing reconciliation cron (brief 0074, AC-04). The per-unit charge follows
// the active unit count, kept in sync by a best-effort post-commit hook in the
// unit actions (`syncStripeSubscriptionQuantity`). That hook never throws — a
// transient Stripe error leaves the subscription quantity drifted from the real
// unit count. This sweep is the safety net: for every Negócio with an active
// subscription, it re-asserts `quantity == active units`, fixing any drift.
//
// PER-ORG TOLERANT (mirrors reconcilePendingProducts): one org whose Stripe call
// fails does NOT abort the sweep — `syncStripeSubscriptionQuantity` swallows its
// own errors, so the loop always completes and the next pass retries.

// Enumerate the Negócios with a live Stripe subscription. Read on the raw pool:
// the cron is platform-wide infra with no session, and a NOBYPASSRLS role can't
// read the RLS-guarded org_billing across orgs. The rows carry only the org id we
// then reconcile org-scoped (each sync reads/writes that org's own data).
async function orgIdsWithSubscription(): Promise<string[]> {
  const res = await getEventStorePool().query<{ org_id: string }>(
    "SELECT org_id FROM org_billing WHERE stripe_subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due')",
  )
  return res.rows.map((r) => r.org_id)
}

/**
 * Reconcile the Stripe subscription quantity of every actively-subscribed
 * Negócio against its live unit count. Returns the number of orgs swept.
 */
export async function reconcileBillingQuantities(): Promise<number> {
  const orgIds = await orgIdsWithSubscription()
  for (const orgId of orgIds) {
    // syncStripeSubscriptionQuantity is a no-op when already in sync and never
    // throws, so the sweep is idempotent and tolerant.
    await syncStripeSubscriptionQuantity(orgId)
  }
  return orgIds.length
}
