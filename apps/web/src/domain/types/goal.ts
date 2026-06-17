import { Schema } from 'effect'

// Management goal as a first-class entity (brief 0042, AC-01 — Copiloto de
// Gestão, Onda 1). The owner declares a monthly profit target per unit; the
// Copiloto surface tracks realizado · ritmo · projeção against it.
//
// Category: CRUD+snapshot (a definition, not temporal truth) — but written
// event-first like every entity in the app (`GoalConfig` + `emitEvent` +
// replay), per ADR 0010 / web/CLAUDE.md ("Sem mudança de estado sem evento").
//
// Stored at `tenants/{tenantId}/goals/{id}`, with the doc id derived from
// `(unitId, period)` so a goal is unique per unit/month and resolvable by a
// direct get (no cross-tenant query, no index).
export const GoalType = Schema.Literal('profit')
export type GoalType = typeof GoalType.Type

export const Goal = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    // The unit this goal belongs to. Goals are always per-unit; the consolidated
    // view (AC-07) sums per-unit goals — there is no tenant-level goal doc.
    unitId: Schema.String,
    // Billing/measurement period as `YYYY-MM` (monthly — brief decision).
    period: Schema.String,
    // Only `profit` in Onda 1; the literal stays open for revenue/cost sub-goals.
    type: GoalType,
    // The target in cents. Always positive (a zero/negative goal is meaningless).
    targetCents: Schema.Number,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Goal = typeof Goal.Type

export const GOAL_TARGET_MIN_CENTS = 1

// `YYYY-MM`, months 01–12.
export const GOAL_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidGoalPeriod(period: string): boolean {
  return GOAL_PERIOD_PATTERN.test(period)
}

// Deterministic doc id — keeps a goal unique per (unit, period) and lets the
// read-model resolve it with a direct get instead of a query. `type` is part
// of the key so revenue/cost sub-goals (future) don't collide with profit.
export function goalDocId(type: GoalType, unitId: string, period: string): string {
  return `${type}__${unitId}__${period}`
}
