import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { orgs } from './orgs'
import { subscriptionPlans } from './subscription_plans'

/**
 * Join table for the `subscription-plan ↔ catalog-item` N:N relation (brief 0068
 * D3) — the relational projection of `subscription_plans.included_item_ids` (the
 * JSONB array that, before D3, forced "which plans include item Y?" to a `@>`
 * containment scan).
 *
 * This is a DERIVED projection, not an aggregate: no `version` / `aggregate_path`
 * / timestamps of its own. The TRUTH stays in the `subscription-plan` reduced
 * state (`includedItemIds`, reducer untouched, ADR 0013 D3). The
 * `subscription-plan` projector rewrites these rows in the SAME ACID transaction
 * as the parent upsert (delete-then-insert, so a shrunk array leaves no orphans).
 * Replay reconstructs them from the array; they are write-derived and never read
 * to rehydrate the aggregate.
 *
 * IMPORTANT: this mirrors the LIVE plan definition only. The frozen
 * `subscriptions.plan` snapshot (ADR 0010) is never mirrored — its coverage stays
 * in JSONB and is queried as a snapshot.
 *
 * Org-scoped under RLS (org-only). Composite FKs (D2 pattern): `(org_id, plan_id)
 * → subscription_plans(org_id, id)` CASCADE (rows derived from the parent);
 * `(org_id, item_id) → catalog_items(org_id, id)` RESTRICT (an item covered by a
 * plan can't be hard-deleted).
 */
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
    // The index that pays for the join: the inverse query "plans including item Y".
    index('plan_included_items_org_id_item_id_idx').on(table.orgId, table.itemId),
  ],
)

export type StoredPlanIncludedItemRow = typeof planIncludedItems.$inferSelect
export type NewPlanIncludedItemRow = typeof planIncludedItems.$inferInsert
