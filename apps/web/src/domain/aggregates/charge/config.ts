import type { AggregateConfig } from '@/domain/effect/event-store'
import { ChargeEventSchema, type ChargeEvent } from './events'
import { applyChargeEvent } from './reducer'
import { INITIAL_CHARGE_STATE, type ChargeState } from './types'

export const ChargeConfig: AggregateConfig<ChargeState, ChargeEvent> = {
  type: 'charge',
  initialState: INITIAL_CHARGE_STATE,
  reducer: applyChargeEvent,
  schema: ChargeEventSchema,
  currentSchemaVersion: 1,
}
