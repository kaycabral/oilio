import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'
import { subscriptionPlans } from './subscription_plans'
import { units } from './units'

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
    index('plan_unit_allowlist_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredPlanUnitAllowlistRow = typeof planUnitAllowlist.$inferSelect
export type NewPlanUnitAllowlistRow = typeof planUnitAllowlist.$inferInsert
