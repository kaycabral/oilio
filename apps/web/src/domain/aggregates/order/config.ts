import type { AggregateConfig } from '@/domain/effect/event-store'
import { OrderEventSchema, type OrderEvent } from './events'
import { applyOrderEvent } from './reducer'
import { INITIAL_ORDER_STATE, type OrderState } from './types'

export const OrderConfig: AggregateConfig<OrderState, OrderEvent> = {
  type: 'order',
  initialState: INITIAL_ORDER_STATE,
  reducer: applyOrderEvent,
  schema: OrderEventSchema,
  currentSchemaVersion: 1,
}
