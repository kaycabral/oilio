import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { categories } from './categories'
import { orgs } from './orgs'
import { subscriptionPlans } from './subscription_plans'

export const planIncludedCategories = pgTable(
  'plan_included_categories',
  {
    orgId: text('org_id').notNull(),
    planId: text('plan_id').notNull(),
    categoryId: text('category_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.planId, table.categoryId] }),
    foreignKey({
      name: 'plan_included_categories_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_included_categories_plan_id_fk',
      columns: [table.orgId, table.planId],
      foreignColumns: [subscriptionPlans.orgId, subscriptionPlans.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_included_categories_category_id_fk',
      columns: [table.orgId, table.categoryId],
      foreignColumns: [categories.orgId, categories.id],
    }).onDelete('restrict'),
    index('plan_included_categories_org_id_category_id_idx').on(table.orgId, table.categoryId),
  ],
)

export type StoredPlanIncludedCategoryRow = typeof planIncludedCategories.$inferSelect
export type NewPlanIncludedCategoryRow = typeof planIncludedCategories.$inferInsert
