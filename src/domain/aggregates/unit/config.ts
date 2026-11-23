import type { AggregateConfig } from '@/domain/effect/event-store'
import { UnitEventSchema, type UnitEvent } from './events'
import { applyUnitEvent } from './reducer'
import { INITIAL_UNIT_STATE, type UnitState } from './types'

export const UnitConfig: AggregateConfig<UnitState, UnitEvent> = {
  type: 'unit',
  initialState: INITIAL_UNIT_STATE,
  reducer: applyUnitEvent,
  schema: UnitEventSchema,
  currentSchemaVersion: 1,
}
