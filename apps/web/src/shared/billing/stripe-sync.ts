import { getStripe } from '@/shared/billing/stripe-client'
import { logger } from '@/shared/lib/logger'
import { getOrgBilling } from '@/shared/org/billing-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

// Sync the Stripe subscription quantity to the Negócio's active unit count
// (brief 0073, AC-02). Per-unit graduated billing: when a unit is created/
// archived/deleted, the subscription `quantity` must follow so the next invoice
// charges the right amount.
//
// Called POST-COMMIT from the unit actions, following the canonical "commit
// event → fire-and-forget side effect that NEVER throws" pattern (mirrors
// dispatchNotificationReactions). A failure here must NOT roll back the unit
// mutation — the reconcile cron (brief 0074) closes any resulting drift. Stripe
// is the source of truth for the charge; Oilio is the source of truth for the
// unit count.
export async function syncStripeSubscriptionQuantity(orgId: string): Promise<void> {
  try {
    const billing = await getOrgBilling(orgId)
    // No active paid subscription → nothing to sync (Free has no Stripe object).
    if (!billing.stripeSubscriptionId) return

    const quantity = Math.max(1, (await listUnitsForOrg(orgId)).length)
    if (quantity === billing.unitQuantity) return

    const stripe = getStripe()
    const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId)
    const item = subscription.items.data[0]
    if (!item) return

    await stripe.subscriptions.update(billing.stripeSubscriptionId, {
      items: [{ id: item.id, quantity }],
      // Charge/credit the difference within the current cycle (fair, SaaS default).
      proration_behavior: 'create_prorations',
    })
    // The org_billing.unit_quantity will be reconciled by the webhook
    // (customer.subscription.updated) — Stripe is the source of truth.
  } catch (err) {
    // Non-transactional side effect — log, never throw. The reconcile cron fixes drift.
    logger.error('failed', { scope: 'syncStripeSubscriptionQuantity', orgId, err })
  }
}
