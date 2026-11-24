import type { AggregateConfig } from '@/domain/effect/event-store'
import { CashMovementEventSchema, type CashMovementEvent } from './events'
import { applyCashMovementEvent } from './reducer'
import { INITIAL_CASH_MOVEMENT_STATE, type CashMovementState } from './types'

export const CashMovementConfig: AggregateConfig<CashMovementState, CashMovementEvent> = {
  type: 'cash_movement',
  initialState: INITIAL_CASH_MOVEMENT_STATE,
  reducer: applyCashMovementEvent,
  schema: CashMovementEventSchema,
  currentSchemaVersion: 1,
}
