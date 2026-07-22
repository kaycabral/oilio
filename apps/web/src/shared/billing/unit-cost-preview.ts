import { getStripe } from '@/shared/billing/stripe-client'
import { stripePriceId } from '@/shared/billing/stripe-prices'
import { logger } from '@/shared/lib/logger'
import { getOrgBilling } from '@/shared/org/billing-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'
import type Stripe from 'stripe'

export type UnitCostPreview = {
  prorationCents: number
  newMonthlyDeltaCents: number
  newTotalMonthlyCents: number
  currency: string
}

export type UnitAdditionCost =
  | { charged: false }
  | { charged: true; preview: UnitCostPreview | null }

function isProrationLine(line: Stripe.InvoiceLineItem): boolean {
  return line.parent?.subscription_item_details?.proration === true
}

function recurringTotalCents(invoice: Stripe.Response<Stripe.Invoice>): number {
  return invoice.lines.data
    .filter((line) => !isProrationLine(line))
    .reduce((sum, line) => sum + line.amount, 0)
}

export async function getUnitAdditionCost(orgId: string): Promise<UnitAdditionCost> {
  const billing = await getOrgBilling(orgId)
  if (!billing.stripeSubscriptionId) return { charged: false }

  const nextQuantity = (await listUnitsForOrg(orgId)).length + 1
  const projectedCharged = nextQuantity > billing.unitQuantity

  try {
    const stripe = getStripe()
    const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId)
    const unitPriceId = billing.billingCycle
      ? stripePriceId(billing.tier, billing.billingCycle)
      : null
    const item =
      subscription.items.data.find((i) => i.price.id === unitPriceId) ?? subscription.items.data[0]
    if (!item) return { charged: true, preview: null }

    const currentQuantity = item.quantity ?? billing.unitQuantity
    if (nextQuantity <= currentQuantity) return { charged: false }

    const [current, next] = await Promise.all([
      stripe.invoices.createPreview({ subscription: subscription.id }),
      stripe.invoices.createPreview({
        subscription: subscription.id,
        subscription_details: {
          items: [{ id: item.id, quantity: nextQuantity }],
          proration_behavior: 'create_prorations',
        },
      }),
    ])

    const prorationTotal = (invoice: Stripe.Response<Stripe.Invoice>): number =>
      invoice.lines.data.filter(isProrationLine).reduce((sum, line) => sum + line.amount, 0)

    const prorationCents = prorationTotal(next) - prorationTotal(current)
    const newTotalMonthlyCents = recurringTotalCents(next)
    const newMonthlyDeltaCents = newTotalMonthlyCents - recurringTotalCents(current)

    return {
      charged: true,
      preview: {
        prorationCents,
        newMonthlyDeltaCents,
        newTotalMonthlyCents,
        currency: next.currency,
      },
    }
  } catch (err) {
    logger.error('failed', { scope: 'getUnitAdditionCost', orgId, err })
    return projectedCharged ? { charged: true, preview: null } : { charged: false }
  }
}
