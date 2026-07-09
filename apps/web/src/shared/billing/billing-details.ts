import { getStripe } from '@/shared/billing/stripe-client'
import { logger } from '@/shared/lib/logger'
import 'server-only'

export type PaymentMethodSummary = {
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

export type InvoiceSummary = {
  id: string
  date: string
  amount: number
  currency: string
  status: string
  hostedUrl: string | null
}

export async function getDefaultPaymentMethod(
  stripeCustomerId: string,
): Promise<PaymentMethodSummary | null> {
  try {
    const stripe = getStripe()
    const customer = await stripe.customers.retrieve(stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    })
    if (customer.deleted) return null

    const defaultPm = customer.invoice_settings.default_payment_method
    const pm =
      defaultPm && typeof defaultPm !== 'string'
        ? defaultPm
        : (await stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card', limit: 1 }))
            .data[0]

    if (!pm?.card) return null
    return {
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    }
  } catch (err) {
    logger.error('getDefaultPaymentMethod failed', { scope: 'billing-details', err })
    return null
  }
}

export async function listRecentInvoices(
  stripeCustomerId: string,
  limit = 6,
): Promise<InvoiceSummary[]> {
  try {
    const stripe = getStripe()
    const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit })
    return invoices.data.map((inv) => ({
      id: inv.id,
      date: new Date(inv.created * 1000).toISOString(),
      amount: inv.total,
      currency: inv.currency,
      status: inv.status ?? 'draft',
      hostedUrl: inv.hosted_invoice_url ?? null,
    }))
  } catch (err) {
    logger.error('listRecentInvoices failed', { scope: 'billing-details', err })
    return []
  }
}
