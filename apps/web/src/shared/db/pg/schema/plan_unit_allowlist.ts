import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { subscriptionPlans } from './subscription_plans'
import { units } from './units'

/**
 * Join table for the `subscription-plan ↔ unit allowlist` N:N relation (brief
 * 0068 D3) — the relational projection of `subscription_plans.unit_allowlist`
 * (the OPTIONAL JSONB array restricting where a plan can be consumed).
 *
 * Derived projection, no version / aggregate_path of its own. The TRUTH stays in
 * the `subscription-plan` reduced state (`unitAllowlist`, reducer untouched, ADR
 * 0013 D3). The `subscription-plan` projector rewrites these rows in the SAME
 * ACID tx (delete-then-insert).
 *
 * NULL semantics: `unitAllowlist` is NULLABLE — `null`/absent means "no
 * restriction" (the plan is usable anywhere), so the projector writes ZERO rows.
 * Only a present, non-null array materializes rows. "Has a restriction" is thus
 * `EXISTS(rows for plan)`, not "rows match"; a plan without an allowlist simply
 * has no rows. Only the LIVE plan definition is mirrored — the frozen
 * `subscriptions.plan` snapshot (ADR 0010) is never mirrored.
 *
 * Org-scoped under RLS (org-only). Composite FKs (D2 pattern): `(org_id, plan_id)
 * → subscription_plans(org_id, id)` CASCADE; `(org_id, unit_id) → units(org_id,
 * id)` RESTRICT (a unit in a plan's allowlist can't be hard-deleted).
 */
export const planUnitAllowlist = pgTable(
  'plan_unit_allowlist',
  {
    orgId: text('org_id').notNull(),
    planId: text('plan_id').notNull(),
    unitId: text('unit_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.planId, table.unitId] }),
    foreignKey({
      name: 'plan_unit_allowlist_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_unit_allowlist_plan_id_fk',
      columns: [table.orgId, table.planId],
      foreignColumns: [subscriptionPlans.orgId, subscriptionPlans.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_unit_allowlist_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    // The index that pays for the join: the inverse query "plans allowing unit X".
    index('plan_unit_allowlist_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredPlanUnitAllowlistRow = typeof planUnitAllowlist.$inferSelect
export type NewPlanUnitAllowlistRow = typeof planUnitAllowlist.$inferInsert
