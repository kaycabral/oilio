'use server'

import { OrgBillingConfig } from '@/domain/aggregates/org-billing/config'
import { type BillingCycle, type Tier } from '@/domain/billing/tiers'
import { aggregateRef } from '@/domain/effect'
import { settingsHash } from '@/features/settings/core/settings-sections'
import { getStripe } from '@/shared/billing/stripe-client'
import { stripePriceId } from '@/shared/billing/stripe-prices'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { getOrgBilling } from '@/shared/org/billing-read'
import { guardCapability } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { toRoute } from '@/shared/routes'
import { requireEnv } from '@cbrl/env'
import { logger } from '@cbrl/log'
import { redirect } from 'next/navigation'

export type CheckoutResult = { ok: false; error: string }

function parseTier(raw: string): Tier | null {
  return raw === 'pro' || raw === 'advanced' ? raw : null
}
function parseCycle(raw: string): BillingCycle | null {
  return raw === 'monthly' || raw === 'annual' ? raw : null
}

function appUrl(): string {
  return requireEnv('NEXT_PUBLIC_SITE_URL')
}

async function resolveStripeCustomer(
  orgId: string,
  actorUid: string,
  ownerEmail: string | null,
): Promise<string> {
  const billing = await getOrgBilling(orgId)
  if (billing.stripeCustomerId) return billing.stripeCustomerId

  const stripe = getStripe()

  const existing = await stripe.customers.search({
    query: `metadata["orgId"]:"${orgId}"`,
    limit: 1,
  })
  const customer =
    existing.data[0] ??
    (await stripe.customers.create(
      { metadata: { orgId }, ...(ownerEmail ? { email: ownerEmail } : {}) },
      { idempotencyKey: `org-billing-customer:${orgId}` },
    ))

  const res = await emitEvent(OrgBillingConfig, aggregateRef(OrgBillingConfig, orgId, orgId), {
    _tag: 'org_billing.updated',
    actorId: actorUid,
    payload: { changes: { id: orgId, orgId, stripeCustomerId: customer.id } },
  })
  if (!res.ok) throw new Error(`persist stripe customer failed: ${res.error}`)
  return customer.id
}

export async function startCheckout(formData: FormData): Promise<CheckoutResult> {
  const r = await guardCapability('canManageBilling')
  if (!r.ok) return { ok: false, error: r.error }

  const tier = parseTier(formString(formData, 'tier').trim())
  const cycle = parseCycle(formString(formData, 'cycle').trim())
  if (!tier || !cycle) return { ok: false, error: 'Plano ou ciclo inválido' }

  const priceId = stripePriceId(tier, cycle)
  if (!priceId) return { ok: false, error: 'Plano sem cobrança (Grátis não requer checkout)' }

  const orgId = r.ctx.membership.orgId

  let checkoutUrl: string
  try {
    const customerId = await resolveStripeCustomer(orgId, r.ctx.session.uid, r.ctx.session.email)
    const quantity = Math.max(1, (await listUnitsForOrg(orgId)).length)

    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity }],
      allow_promotion_codes: true,
      client_reference_id: orgId,
      subscription_data: { metadata: { orgId } },
      success_url: `${appUrl()}/agenda${settingsHash('billing')}`,
      cancel_url: `${appUrl()}/agenda${settingsHash('billing')}`,
    })
    if (!session.url) return { ok: false, error: 'Falha ao iniciar o checkout' }
    checkoutUrl = session.url
  } catch (err) {
    logger.error('startCheckout failed', { scope: 'startCheckout', orgId, err })
    return { ok: false, error: 'Não foi possível iniciar o checkout. Tente de novo.' }
  }

  redirect(toRoute(checkoutUrl))
}

export async function manageBilling(): Promise<CheckoutResult> {
  const r = await guardCapability('canManageBilling')
  if (!r.ok) return { ok: false, error: r.error }

  const billing = await getOrgBilling(r.ctx.membership.orgId)
  if (!billing.stripeCustomerId) {
    return { ok: false, error: 'Nenhuma assinatura para gerenciar. Assine um plano primeiro.' }
  }

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: `${appUrl()}/settings/billing`,
  })
  redirect(toRoute(portal.url))
}
