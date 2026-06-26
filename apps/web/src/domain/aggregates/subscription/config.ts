import type { AggregateConfig } from '@/domain/effect/event-store'
import { SubscriptionEventSchema, type SubscriptionEvent } from './events'
import { applySubscriptionEvent } from './reducer'
import { INITIAL_SUBSCRIPTION_STATE, type SubscriptionState } from './types'

export const SubscriptionConfig: AggregateConfig<SubscriptionState, SubscriptionEvent> = {
  type: 'subscription',
  initialState: INITIAL_SUBSCRIPTION_STATE,
  reducer: applySubscriptionEvent,
  schema: SubscriptionEventSchema,
  currentSchemaVersion: 1,
}
