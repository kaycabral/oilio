'use server'

import { OrgBillingConfig } from '@/domain/aggregates/org-billing/config'
import { type BillingCycle, type Tier } from '@/domain/billing/tiers'
import { aggregateRef } from '@/domain/effect'
import { getStripe } from '@/shared/billing/stripe-client'
import { stripePriceId } from '@/shared/billing/stripe-prices'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { logger } from '@/shared/lib/logger'
import { getOrgBilling } from '@/shared/org/billing-read'
import { requireOwnerCtx } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { toRoute } from '@/shared/routes'
import { requireEnv } from '@cbrl/env'
import { redirect } from 'next/navigation'

export type CheckoutResult = { ok: false; error: string }

// Only the owner subscribes/manages the Plano Oilio (brief 0073, decisão fechada).
// Parse the chosen tier + cycle from the form (the /pricing CTA posts hidden fields).
function parseTier(raw: string): Tier | null {
  return raw === 'pro' || raw === 'advanced' ? raw : null
}
function parseCycle(raw: string): BillingCycle | null {
  return raw === 'monthly' || raw === 'annual' ? raw : null
}

function appUrl(): string {
  // Canonical public origin of the app — the same var the self-booking QR uses
  // (`UnitBookingQr`) and the one set in .env.local. Fail-fast via @cbrl/env so a
  // missing origin never produces a broken Stripe return URL.
  return requireEnv('NEXT_PUBLIC_SITE_URL')
}

// Resolve or lazily create the Stripe Customer for the Negócio. Free orgs have no
// customer; the first checkout creates one (metadata.orgId is how the webhook
// resolves the org). Persists the id via an org_billing event so subsequent
// checkouts reuse it.
async function resolveStripeCustomer(orgId: string, actorUid: string): Promise<string> {
  const billing = await getOrgBilling(orgId)
  if (billing.stripeCustomerId) return billing.stripeCustomerId

  const stripe = getStripe()
  const customer = await stripe.customers.create({ metadata: { orgId } })

  // Persist the customer id (CRUD mirror) — keeps it stable across checkouts and
  // seeds the stripe→org lookup index (the projector mirrors it). Tier stays as-is
  // until the subscription activates via the webhook.
  //
  // Carry id/orgId in the changes for parity with the webhook's `emitUpdate`, so the
  // reduced state is self-consistent regardless of the projector. The projector is
  // the actual guarantee (it sources org_id/id from the ref, not the reduced state —
  // see org-billing-projector.ts), so an empty identity is structurally impossible;
  // this stays belt-and-suspenders and keeps every org_billing writer uniform.
  const res = await emitEvent(OrgBillingConfig, aggregateRef(OrgBillingConfig, orgId, orgId), {
    _tag: 'org_billing.updated',
    actorId: actorUid,
    payload: { changes: { id: orgId, orgId, stripeCustomerId: customer.id } },
  })
  // Surface a failed persist as a typed error the caller maps to a friendly result
  // instead of letting the Effect reject bubble to a raw 500 (UX: the button shows
  // an inline error, never a crash page).
  if (!res.ok) throw new Error(`persist stripe customer failed: ${res.error}`)
  return customer.id
}

// Start a Stripe Checkout Session for the active Negócio (brief 0073, AC-01).
// Owner-only. Per-unit graduated pricing: quantity = active unit count; Stripe
// computes the total from the graduated Price. Returns an error result on
// validation failure, otherwise redirects to the hosted Checkout.
export async function startCheckout(formData: FormData): Promise<CheckoutResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const tier = parseTier(formString(formData, 'tier').trim())
  const cycle = parseCycle(formString(formData, 'cycle').trim())
  if (!tier || !cycle) return { ok: false, error: 'Plano ou ciclo inválido' }

  const priceId = stripePriceId(tier, cycle)
  if (!priceId) return { ok: false, error: 'Plano sem cobrança (Free não requer checkout)' }

  const orgId = r.ctx.membership.orgId

  // Resolve the customer, count units and open the Checkout Session inside a
  // try/catch so ANY failure (a Stripe API error, or the org_billing persist
  // being refused) becomes a friendly inline result — never a raw 500 on the
  // subscribe button. `redirect` must stay OUTSIDE the try (it works by throwing
  // NEXT_REDIRECT, which a catch would swallow — Next docs, redirect §Caveats).
  let checkoutUrl: string
  try {
    const customerId = await resolveStripeCustomer(orgId, r.ctx.session.uid)
    const quantity = Math.max(1, (await listUnitsForOrg(orgId)).length)

    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // Do NOT set payment_method_types — let Stripe pick dynamically (best-practice).
      line_items: [{ price: priceId, quantity }],
      client_reference_id: orgId,
      subscription_data: { metadata: { orgId } },
      success_url: `${appUrl()}/billing?checkout=success`,
      cancel_url: `${appUrl()}/billing?checkout=cancel`,
    })
    if (!session.url) return { ok: false, error: 'Falha ao iniciar o checkout' }
    checkoutUrl = session.url
  } catch (err) {
    logger.error('startCheckout failed', { scope: 'startCheckout', orgId, err })
    return { ok: false, error: 'Não foi possível iniciar o checkout. Tente de novo.' }
  }

  // session.url is Stripe's hosted Checkout (external) — not an in-app typed
  // route; toRoute is the sanctioned narrowing seam for an opaque redirect target.
  redirect(toRoute(checkoutUrl))
}

// Open the Stripe Customer Portal for self-service management (cancel/upgrade/
// payment method) — owner-only (brief 0073, AC-03). Redirects to the hosted portal.
export async function manageBilling(): Promise<CheckoutResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const billing = await getOrgBilling(r.ctx.membership.orgId)
  if (!billing.stripeCustomerId) {
    return { ok: false, error: 'Nenhuma assinatura para gerenciar. Assine um plano primeiro.' }
  }

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: `${appUrl()}/billing`,
  })
  // External Stripe-hosted portal URL — same narrowing seam as the checkout redirect.
  redirect(toRoute(portal.url))
}
