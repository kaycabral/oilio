import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { categories } from './categories'
import { orgs } from './orgs'
import { subscriptionPlans } from './subscription_plans'

/**
 * Join table for the `subscription-plan ↔ category` N:N relation (brief 0068 D3)
 * — the relational projection of `subscription_plans.included_category_ids` (the
 * JSONB array that, before D3, forced `anyPlanIncludesCategory` to a `@>`
 * containment scan).
 *
 * Same contract as `plan_included_items`: derived projection, no version /
 * aggregate_path of its own; the truth is the `subscription-plan` reduced state
 * (`includedCategoryIds`, reducer untouched); the projector rewrites these rows
 * in the same ACID tx (delete-then-insert); replay reconstructs from the array.
 * Only the LIVE plan definition is mirrored — the frozen `subscriptions.plan`
 * snapshot (ADR 0010) is never mirrored.
 *
 * Org-scoped under RLS (org-only). Composite FKs (D2 pattern): `(org_id, plan_id)
 * → subscription_plans(org_id, id)` CASCADE; `(org_id, category_id) →
 * categories(org_id, id)` RESTRICT (a category covered by a plan can't be
 * hard-deleted — `categoryReferenceCount`).
 */
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
    // The index that pays for the join: the inverse query "plans including category Y".
    index('plan_included_categories_org_id_category_id_idx').on(table.orgId, table.categoryId),
  ],
)

export type StoredPlanIncludedCategoryRow = typeof planIncludedCategories.$inferSelect
export type NewPlanIncludedCategoryRow = typeof planIncludedCategories.$inferInsert
