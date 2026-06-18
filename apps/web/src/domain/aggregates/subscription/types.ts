import type { Subscription, SubscriptionPlanSnapshot } from '@/domain/types/subscription'

export type { SubscriptionStatus } from '@/domain/types/subscription'

// A projeção event-sourced É o doc operacional `Subscription` + a versão do
// stream. Não há estado paralelo: o reducer reconstrói todos os campos
// operacionais só a partir dos eventos (replay == doc, deep-equal).
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

// Estado-semente antes do primeiro evento. `subscription.created` sobrescreve
// tudo — estes valores só existem pra completude de tipo do replay vazio.
export const INITIAL_SUBSCRIPTION_STATE: SubscriptionState = {
  id: '',
  orgId: '',
  unitId: '',
  customerId: '',
  customerUserId: null,
  plan: INITIAL_PLAN_SNAPSHOT,
  status: 'pending',
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
