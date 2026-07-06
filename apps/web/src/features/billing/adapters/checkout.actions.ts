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
import { guardCapability } from '@/shared/org/membership'
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

// Resolve the single Stripe Customer for the Negócio, creating it once. There is
// exactly ONE customer per org, keyed by `metadata.orgId` — the webhook resolves
// the org from it. Idempotent by construction against concurrency (two rapid
// "Assinar" clicks, or an abandoned-then-retried checkout):
//
//   1. Reuse the persisted id when we already have it (the common path).
//   2. Otherwise ask Stripe — the system of record — for an existing customer
//      carrying this `metadata.orgId`, and reuse it. This closes the window
//      where a previous attempt created a customer at Stripe but its id had not
//      yet been read back locally (an abandoned/failed checkout leaves the
//      customer behind; we adopt it instead of minting another).
//   3. Only if Stripe has none do we create — passing an `idempotencyKey` derived
//      from the org so that two concurrent creates collapse into ONE customer at
//      Stripe (the second request returns the first's result, not a duplicate).
//
// Before this, `customers.create` ran unconditionally with no reuse lookup and no
// idempotency key: any read that predated the persist (a race, a double-submit)
// minted a fresh email-less customer, and the customer leaked to Stripe even when
// the subsequent event-store write lost the version race and the whole action
// failed. See #1373 for the reproduction.
async function resolveStripeCustomer(
  orgId: string,
  actorUid: string,
  ownerEmail: string | null,
): Promise<string> {
  const billing = await getOrgBilling(orgId)
  if (billing.stripeCustomerId) return billing.stripeCustomerId

  const stripe = getStripe()

  // Reuse-first: Stripe is the source of truth for "does a customer exist for this
  // org", independent of whether our projection has caught up. Search by the org
  // metadata; adopt the first hit rather than creating a second.
  const existing = await stripe.customers.search({
    query: `metadata["orgId"]:"${orgId}"`,
    limit: 1,
  })
  const customer =
    existing.data[0] ??
    // Deterministic key per org: concurrent creates within Stripe's idempotency
    // window collapse to a single customer instead of one-per-request. The email
    // (the owner's, from the session) makes the customer human-identifiable from
    // birth instead of an id-only record.
    (await stripe.customers.create(
      { metadata: { orgId }, ...(ownerEmail ? { email: ownerEmail } : {}) },
      { idempotencyKey: `org-billing-customer:${orgId}` },
    ))

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
  // A lost version race here no longer leaks a customer: the create above is now
  // idempotent/reuse-first, so a retry adopts the same customer. Surface the failed
  // persist as a typed error the caller maps to a friendly result instead of letting
  // the Effect reject bubble to a raw 500 (UX: the button shows an inline error).
  if (!res.ok) throw new Error(`persist stripe customer failed: ${res.error}`)
  return customer.id
}

// Start a Stripe Checkout Session for the active Negócio (brief 0073, AC-01).
// Owner-only. Per-unit graduated pricing: quantity = active unit count; Stripe
// computes the total from the graduated Price. Returns an error result on
// validation failure, otherwise redirects to the hosted Checkout.
export async function startCheckout(formData: FormData): Promise<CheckoutResult> {
  // Billing is gated on the `canManageBilling` capability (owner-only preset),
  // not a `role === 'owner'` check (brief 0075 AC-01, #1377). Same owner-only
  // behavior today; data-driven for the future.
  const r = await guardCapability('canManageBilling')
  if (!r.ok) return { ok: false, error: r.error }

  const tier = parseTier(formString(formData, 'tier').trim())
  const cycle = parseCycle(formString(formData, 'cycle').trim())
  if (!tier || !cycle) return { ok: false, error: 'Plano ou ciclo inválido' }

  const priceId = stripePriceId(tier, cycle)
  if (!priceId) return { ok: false, error: 'Plano sem cobrança (Grátis não requer checkout)' }

  const orgId = r.ctx.membership.orgId

  // Resolve the customer, count units and open the Checkout Session inside a
  // try/catch so ANY failure (a Stripe API error, or the org_billing persist
  // being refused) becomes a friendly inline result — never a raw 500 on the
  // subscribe button. `redirect` must stay OUTSIDE the try (it works by throwing
  // NEXT_REDIRECT, which a catch would swallow — Next docs, redirect §Caveats).
  let checkoutUrl: string
  try {
    const customerId = await resolveStripeCustomer(orgId, r.ctx.session.uid, r.ctx.session.email)
    const quantity = Math.max(1, (await listUnitsForOrg(orgId)).length)

    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // Do NOT set payment_method_types — let Stripe pick dynamically (best-practice).
      line_items: [{ price: priceId, quantity }],
      // Surface the "código promocional" field in hosted Checkout so a customer can
      // redeem a promotion code (launch campaigns, comps for internal/founder orgs,
      // partner discounts) — the discount is resolved entirely Stripe-side, so the
      // subscription still activates on the same Price and the webhook derives the
      // tier from that Price regardless of the amount charged.
      allow_promotion_codes: true,
      client_reference_id: orgId,
      subscription_data: { metadata: { orgId } },
      success_url: `${appUrl()}/settings/billing?checkout=success`,
      cancel_url: `${appUrl()}/settings/billing?checkout=cancel`,
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
  // External Stripe-hosted portal URL — same narrowing seam as the checkout redirect.
  redirect(toRoute(portal.url))
}
