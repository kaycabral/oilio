import type { StoredOrgBilling } from '@/domain/types/org-billing'

// Projection of the org_billing aggregate = the StoredOrgBilling doc + the stream
// version. Mirror of Stripe's ledger (CRUD, not ES truth).
export type OrgBillingState = StoredOrgBilling & { readonly _version: number }

// Seed before the first event — `org_billing.activated` overwrites everything.
// A Negócio with no billing row is treated as free by getOrgBilling, so this
// seed is only the pre-activation shape for the reducer.
export const INITIAL_ORG_BILLING_STATE: OrgBillingState = {
  id: '',
  orgId: '',
  tier: 'free',
  status: 'active',
  billingCycle: null,
  unitQuantity: 1,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
