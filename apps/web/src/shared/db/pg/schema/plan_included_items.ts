import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { orgs } from './orgs'
import { subscriptionPlans } from './subscription_plans'

export const planIncludedItems = pgTable(
  'plan_included_items',
  {
    orgId: text('org_id').notNull(),
    planId: text('plan_id').notNull(),
    itemId: text('item_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.planId, table.itemId] }),
    foreignKey({
      name: 'plan_included_items_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_included_items_plan_id_fk',
      columns: [table.orgId, table.planId],
      foreignColumns: [subscriptionPlans.orgId, subscriptionPlans.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_included_items_item_id_fk',
      columns: [table.orgId, table.itemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }).onDelete('restrict'),
    index('plan_included_items_org_id_item_id_idx').on(table.orgId, table.itemId),
  ],
)

export type StoredPlanIncludedItemRow = typeof planIncludedItems.$inferSelect
export type NewPlanIncludedItemRow = typeof planIncludedItems.$inferInsert
