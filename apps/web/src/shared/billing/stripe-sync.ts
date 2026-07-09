import { getStripe } from '@/shared/billing/stripe-client'
import { logger } from '@/shared/lib/logger'
import { getOrgBilling } from '@/shared/org/billing-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

export async function syncStripeSubscriptionQuantity(orgId: string): Promise<void> {
  try {
    const billing = await getOrgBilling(orgId)
    if (!billing.stripeSubscriptionId) return

    const quantity = Math.max(1, (await listUnitsForOrg(orgId)).length)
    if (quantity === billing.unitQuantity) return

    const stripe = getStripe()
    const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId)
    const item = subscription.items.data[0]
    if (!item) return

    await stripe.subscriptions.update(billing.stripeSubscriptionId, {
      items: [{ id: item.id, quantity }],
      proration_behavior: 'create_prorations',
    })
  } catch (err) {
    logger.error('failed', { scope: 'syncStripeSubscriptionQuantity', orgId, err })
  }
}
