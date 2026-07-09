import type { StoredOrgBilling } from '@/domain/types/org-billing'

export type OrgBillingState = StoredOrgBilling & { readonly _version: number }

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
