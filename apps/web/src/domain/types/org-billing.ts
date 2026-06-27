import { Schema } from 'effect'

import { BillingCycle, Tier } from '@/domain/billing/tiers'

// SaaS subscription state of a Negócio (Org) with Oilio itself — the "Assinatura
// Oilio" (PRD-Monetizacao-SaaS; Linguagem § Monetização SaaS). CRUD aggregate, a
// read-model MIRROR of Stripe's ledger (Stripe is the system of record), NOT
// event-sourced truth. One row per Negócio (org_id == id, the org is its own scope).
//
// Distinct from the store→customer `Subscription` (núcleo ES, 0043): that is what
// the lojista sells to ITS customers; this is what the lojista pays the cbrl.

// Lifecycle status — mirrors Stripe subscription status. `free` orgs default to
// `active` with no Stripe object (see getOrgBilling default in billing-read).
export const ORG_BILLING_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
] as const
export const OrgBillingStatus = Schema.Literal(...ORG_BILLING_STATUSES)
export type OrgBillingStatus = typeof OrgBillingStatus.Type

export const StoredOrgBilling = Schema.mutable(
  Schema.Struct({
    // org_id == id (the Negócio is its own billing scope).
    id: Schema.String,
    orgId: Schema.String,
    // The Plano Oilio. Free needs no Stripe object.
    tier: Tier,
    status: OrgBillingStatus,
    // null on free (no billing cycle).
    billingCycle: Schema.NullOr(BillingCycle),
    // Charged unit count = active units of the Negócio (graduated pricing). Free = 1.
    unitQuantity: Schema.Number,
    // Stripe linkage — null until first checkout (free orgs never get these).
    stripeCustomerId: Schema.NullOr(Schema.String),
    stripeSubscriptionId: Schema.NullOr(Schema.String),
    // End of the current paid period; capabilities hold until here on cancel.
    currentPeriodEnd: Schema.NullOr(Schema.String),
    // When true, the subscription does not renew — it ends at currentPeriodEnd.
    cancelAtPeriodEnd: Schema.Boolean,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type StoredOrgBilling = typeof StoredOrgBilling.Type
