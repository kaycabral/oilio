import { StoredOrgBilling } from '@/domain/types/org-billing'
import { Schema } from 'effect'

// CRUD events for the org_billing aggregate (the Assinatura Oilio). The reducer
// is the single projection path; events mirror Stripe state changes received via
// the webhook (feature E / brief 0074). Idempotency lives in the reducer (apply
// only changes that differ) + the webhook dedup table.

// First activation (checkout.session.completed) or any full (re)write of state.
export const OrgBillingActivatedSchema = Schema.Struct({
  _tag: Schema.Literal('org_billing.activated'),
  data: StoredOrgBilling,
})

// Partial update (subscription.updated / invoice.payment_failed) — status,
// period, quantity, tier, cancelAtPeriodEnd.
export const OrgBillingUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('org_billing.updated'),
  changes: Schema.partial(StoredOrgBilling),
})

// Subscription ended (subscription.deleted) — drops to free at period end.
export const OrgBillingCanceledSchema = Schema.Struct({
  _tag: Schema.Literal('org_billing.canceled'),
  changes: Schema.partial(StoredOrgBilling),
})

export const OrgBillingEventSchema = Schema.Union(
  OrgBillingActivatedSchema,
  OrgBillingUpdatedSchema,
  OrgBillingCanceledSchema,
)

export type OrgBillingActivated = typeof OrgBillingActivatedSchema.Type
export type OrgBillingUpdated = typeof OrgBillingUpdatedSchema.Type
export type OrgBillingCanceled = typeof OrgBillingCanceledSchema.Type
export type OrgBillingEvent = typeof OrgBillingEventSchema.Type
