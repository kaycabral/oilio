import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { units } from './units'

/**
 * Typed relational projection for the `goal` bounded context (migration feature
 * D, brief 0060, Grupo C) — a monthly profit target per unit (Copiloto de Gestão,
 * brief 0042).
 *
 * Keyed by `aggregate_path` (`orgs/{orgId}/goals/{id}` — org-scoped collection;
 * the doc id is the deterministic `{type}__{unitId}__{period}`). FK
 * `org_id → orgs.org_id`; `org_id` is the leading index column (RLS performance).
 * `unit_id` is NOT NULL (a goal is always per-unit) and is the RLS unit predicate.
 *
 * No PII; no unions — a flat scalar projection (type/period/target_cents).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `type ∈ {profit}` — the enum, as a CHECK (open for future revenue/cost
 *     sub-goals).
 *   - `target_cents` ≥ 1 — a zero/negative goal is meaningless
 *     (`GOAL_TARGET_MIN_CENTS`).
 *   - `unit_id`/`period` NOT NULL and non-empty.
 *   - FK `org_id → orgs.org_id`; `org_id` NOT NULL leading column.
 */
export const goals = pgTable(
  'goals',
  {
    aggregatePath: text('aggregate_path').primaryKey(),

    // ── Identity + org/unit scope ───────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    // A goal is always per-unit — the RLS unit predicate.
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    version: bigint('version', { mode: 'number' }).notNull(),

    // ── Primary-metric invariants (enforced by the DB) ──────────────────────
    // Measurement period as `YYYY-MM`.
    period: text('period').notNull(),
    type: text('type').notNull(),
    targetCents: bigint('target_cents', { mode: 'number' }).notNull(),

    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The goal-type enum, refused at the DB.
    check('goals_type_check', sql`${table.type} IN ('profit')`),
    // A zero/negative goal is meaningless (GOAL_TARGET_MIN_CENTS = 1).
    check('goals_target_cents_positive', sql`${table.targetCents} >= 1`),
    // Non-empty unit/period.
    check('goals_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    check('goals_period_nonempty', sql`char_length(btrim(${table.period})) > 0`),
    // Every goal belongs to a real org.
    foreignKey({
      name: 'goals_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    // Cross-aggregate composite FK (org-scoped).
    foreignKey({
      name: 'goals_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('cascade'),
    // `org_id`-leading indexes: the RLS policy + per-unit goal reads.
    index('goals_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredGoalRow = typeof goals.$inferSelect
export type NewGoalRow = typeof goals.$inferInsert
