import { getStripe } from '@/shared/billing/stripe-client'
import { logger } from '@/shared/lib/logger'
import 'server-only'

// Live Stripe details that back the Cobrança panel but are NOT projected into
// org_billing (Stripe is the system of record for these). Read on demand from
// the Stripe API, server-side, keyed by the org's stripeCustomerId. Every read
// is best-effort: a Stripe failure degrades the panel to an empty block, never a
// crash (the plan card + cancellation still render from org_billing).

export type PaymentMethodSummary = {
  // Stripe's `card.brand`: 'visa' | 'mastercard' | … (mapped to a label in the UI).
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

export type InvoiceSummary = {
  id: string
  // ISO date of the invoice (created); formatted in the UI.
  date: string
  // Total in the smallest currency unit (centavos) + the currency, so the UI
  // formats with Intl instead of us hardcoding "R$".
  amount: number
  currency: string
  // Stripe invoice status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft'.
  status: string
  // Hosted invoice page (Stripe) — opens in a new tab. Null when Stripe didn't
  // provide one (e.g. a draft).
  hostedUrl: string | null
}

// The default card of the customer, if any. Reads the customer's
// `invoice_settings.default_payment_method` (the card Stripe charges), falling
// back to the first attached card. Returns null when there's no card on file.
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

// The customer's most recent invoices (newest first), capped. Empty on any
// failure or when the customer has none yet.
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
