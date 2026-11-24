import type { AggregateConfig } from '@/domain/effect/event-store'
import { GoalEventSchema, type GoalEvent } from './events'
import { applyGoalEvent } from './reducer'
import { INITIAL_GOAL_STATE, type GoalState } from './types'

export const GoalConfig: AggregateConfig<GoalState, GoalEvent> = {
  type: 'goal',
  initialState: INITIAL_GOAL_STATE,
  reducer: applyGoalEvent,
  schema: GoalEventSchema,
  currentSchemaVersion: 1,
}
