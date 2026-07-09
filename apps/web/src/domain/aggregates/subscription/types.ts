import type { Subscription, SubscriptionPlanSnapshot } from '@/domain/types/subscription'

export type { SubscriptionStatus } from '@/domain/types/subscription'

export type SubscriptionState = Subscription & { readonly _version: number }

const INITIAL_PLAN_SNAPSHOT: SubscriptionPlanSnapshot = {
  planId: '',
  name: '',
  priceCents: 0,
  billingCycle: 'monthly',
  includedItemIds: [],
  includedCategoryIds: [],
  usageLimit: { kind: 'unlimited' },
}

export const INITIAL_SUBSCRIPTION_STATE: SubscriptionState = {
  id: '',
  orgId: '',
  unitId: '',
  customerId: '',
  customerUserId: null,
  plan: INITIAL_PLAN_SNAPSHOT,
  status: 'active',
  currentPeriod: { startAt: '', endAt: '', consumed: 0 },
  cancelAtPeriodEnd: false,
  nextChargeDate: null,
  pastDueCycles: 0,
  pastDueThreshold: 2,
  cancellationReason: null,
  cancelledAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
