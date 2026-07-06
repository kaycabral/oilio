'use server'

import { getStripe } from '@/shared/billing/stripe-client'
import { logger } from '@/shared/lib/logger'
import { track } from '@/shared/lib/track'
import { getOrgBilling } from '@/shared/org/billing-read'
import { guardCapability } from '@/shared/org/membership'

export type CancelResult = { ok: true } | { ok: false; error: string }

// Native cancellation of the Assinatura Oilio (brief 0090, AC-09). Gated on the
// `canManageBilling` capability (owner-only preset) — brief 0075 AC-01 / #1377.
// Sets `cancel_at_period_end` on the Stripe subscription so paid access runs
// until the end of the current period; the Stripe webhook
// (`customer.subscription.updated`) then projects `cancelAtPeriodEnd` onto
// org_billing (reused — nothing new in the webhook). This is the in-app
// replacement for sending the owner to the Stripe portal just to cancel.
//
// NOT to be confused with `domain/subscription-self-cancel.ts`, which cancels a
// SALON CUSTOMER's plan (aggregate `subscription`, `/me`) — a different domain.
export async function cancelSubscription(): Promise<CancelResult> {
  const r = await guardCapability('canManageBilling')
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId
  const billing = await getOrgBilling(orgId)
  if (!billing.stripeSubscriptionId) {
    return { ok: false, error: 'Nenhuma assinatura ativa para cancelar.' }
  }

  try {
    const stripe = getStripe()
    await stripe.subscriptions.update(billing.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })
  } catch (err) {
    logger.error('cancelSubscription failed', { scope: 'cancelSubscription', orgId, err })
    return { ok: false, error: 'Não foi possível cancelar agora. Tente de novo.' }
  }

  // Funnel telemetry (brief 0090 § "Eventos"): the confirmation completed. The
  // projection catches up via the webhook — the UI reflects "cancela no fim do
  // ciclo" once org_billing updates.
  track('billing_cancel_confirmed', { org_id: orgId, user_id: r.ctx.session.uid })
  return { ok: true }
}
