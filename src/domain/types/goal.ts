import { Schema } from 'effect'

export const GoalType = Schema.Literal('profit')
export type GoalType = typeof GoalType.Type

export const Goal = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    unitId: Schema.String,
    period: Schema.String,
    type: GoalType,
    targetCents: Schema.Number,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Goal = typeof Goal.Type

export const GOAL_TARGET_MIN_CENTS = 1

export const GOAL_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidGoalPeriod(period: string): boolean {
  return GOAL_PERIOD_PATTERN.test(period)
}

export function goalDocId(type: GoalType, unitId: string, period: string): string {
  return `${type}__${unitId}__${period}`
}
