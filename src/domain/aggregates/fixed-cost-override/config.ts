import type { AggregateConfig } from '@/domain/effect/event-store'
import { FixedCostOverrideEventSchema, type FixedCostOverrideEvent } from './events'
import { applyFixedCostOverrideEvent } from './reducer'
import { INITIAL_FIXED_COST_OVERRIDE_STATE, type FixedCostOverrideState } from './types'

export const FixedCostOverrideConfig: AggregateConfig<
  FixedCostOverrideState,
  FixedCostOverrideEvent
> = {
  type: 'fixed_cost_override',
  initialState: INITIAL_FIXED_COST_OVERRIDE_STATE,
  reducer: applyFixedCostOverrideEvent,
  schema: FixedCostOverrideEventSchema,
  currentSchemaVersion: 1,
}
