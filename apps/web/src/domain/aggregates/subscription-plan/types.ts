import type { SubscriptionPlan } from '@/domain/types/subscription-plan'

export type SubscriptionPlanState = SubscriptionPlan & { readonly _version: number }

export const INITIAL_SUBSCRIPTION_PLAN_STATE: SubscriptionPlanState = {
  id: '',
  orgId: '',
  name: '',
  description: null,
  priceCents: 0,
  billingCycle: 'monthly',
  includedItemIds: [],
  includedCategoryIds: [],
  usageLimit: { kind: 'unlimited' },
  active: false,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
