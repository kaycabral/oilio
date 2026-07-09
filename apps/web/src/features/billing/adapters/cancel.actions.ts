'use server'

import { getStripe } from '@/shared/billing/stripe-client'
import { logger } from '@/shared/lib/logger'
import { track } from '@/shared/lib/track'
import { getOrgBilling } from '@/shared/org/billing-read'
import { guardCapability } from '@/shared/org/membership'

export type CancelResult = { ok: true } | { ok: false; error: string }

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

  track('billing_cancel_confirmed', { org_id: orgId, user_id: r.ctx.session.uid })
  return { ok: true }
}
