import type { AggregateConfig } from '@/domain/effect/event-store'
import { FixedCostEventSchema, type FixedCostEvent } from './events'
import { applyFixedCostEvent } from './reducer'
import { INITIAL_FIXED_COST_STATE, type FixedCostState } from './types'

export const FixedCostConfig: AggregateConfig<FixedCostState, FixedCostEvent> = {
  type: 'fixed_cost',
  initialState: INITIAL_FIXED_COST_STATE,
  reducer: applyFixedCostEvent,
  schema: FixedCostEventSchema,
  currentSchemaVersion: 1,
}
