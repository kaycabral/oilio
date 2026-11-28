import { Goal } from '@/domain/types/goal'
import { Schema, Struct } from 'effect'

export const GoalDefinedSchema = Schema.Struct({
  _tag: Schema.Literal('goal.defined'),
  data: Goal,
})

export const GoalUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('goal.updated'),
  changes: Goal.mapFields(Struct.map(Schema.optional)),
})

export const GoalEventSchema = Schema.Union([GoalDefinedSchema, GoalUpdatedSchema])

export type GoalDefined = typeof GoalDefinedSchema.Type
export type GoalUpdated = typeof GoalUpdatedSchema.Type
export type GoalEvent = typeof GoalEventSchema.Type
