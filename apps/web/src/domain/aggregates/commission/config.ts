import type { AggregateConfig } from '@/domain/effect/event-store'
import { CommissionEventSchema, type CommissionEvent } from './events'
import { applyCommissionEvent } from './reducer'
import { INITIAL_COMMISSION_STATE, type CommissionState } from './types'

export const CommissionConfig: AggregateConfig<CommissionState, CommissionEvent> = {
  type: 'commission',
  initialState: INITIAL_COMMISSION_STATE,
  reducer: applyCommissionEvent,
  schema: CommissionEventSchema,
  currentSchemaVersion: 1,
}
