import type { AggregateConfig } from '@/domain/effect/event-store'
import { SubscriptionPlanEventSchema, type SubscriptionPlanEvent } from './events'
import { applySubscriptionPlanEvent } from './reducer'
import { INITIAL_SUBSCRIPTION_PLAN_STATE, type SubscriptionPlanState } from './types'

export const SubscriptionPlanConfig: AggregateConfig<SubscriptionPlanState, SubscriptionPlanEvent> =
  {
    type: 'subscription_plan',
    initialState: INITIAL_SUBSCRIPTION_PLAN_STATE,
    reducer: applySubscriptionPlanEvent,
    schema: SubscriptionPlanEventSchema,
    currentSchemaVersion: 1,
  }
