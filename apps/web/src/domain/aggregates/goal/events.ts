import { Goal } from '@/domain/types/goal'
import { Schema } from 'effect'

export const GoalDefinedSchema = Schema.Struct({
  _tag: Schema.Literal('goal.defined'),
  data: Goal,
})

export const GoalUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('goal.updated'),
  changes: Schema.partial(Goal),
})

export const GoalEventSchema = Schema.Union(GoalDefinedSchema, GoalUpdatedSchema)

export type GoalDefined = typeof GoalDefinedSchema.Type
export type GoalUpdated = typeof GoalUpdatedSchema.Type
export type GoalEvent = typeof GoalEventSchema.Type
