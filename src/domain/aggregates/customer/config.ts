import type { AggregateConfig } from '@/domain/effect/event-store'
import { CustomerEventSchema, type CustomerEvent } from './events'
import { applyCustomerEvent } from './reducer'
import { INITIAL_CUSTOMER_STATE, type CustomerState } from './types'

export const CustomerConfig: AggregateConfig<CustomerState, CustomerEvent> = {
  type: 'customer',
  initialState: INITIAL_CUSTOMER_STATE,
  reducer: applyCustomerEvent,
  schema: CustomerEventSchema,
  currentSchemaVersion: 1,
}
