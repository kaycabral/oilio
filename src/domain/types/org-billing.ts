import { Schema } from 'effect'

import { BillingCycle, Tier } from '@/domain/billing/tiers'
import { NonNegativeInt } from '@/domain/value-objects'

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
    id: Schema.String,
    orgId: Schema.String,
    tier: Tier,
    status: OrgBillingStatus,
    billingCycle: Schema.NullOr(BillingCycle),
    unitQuantity: NonNegativeInt,
    stripeCustomerId: Schema.NullOr(Schema.String),
    stripeSubscriptionId: Schema.NullOr(Schema.String),
    currentPeriodEnd: Schema.NullOr(Schema.String),
    cancelAtPeriodEnd: Schema.Boolean,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type StoredOrgBilling = typeof StoredOrgBilling.Type
