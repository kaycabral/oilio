import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { orgs } from './orgs'
import { units } from './units'

/**
 * Join table for the `catalog-item ↔ unit` N:N relation (brief 0068 D3) — the
 * relational projection of `catalog_items.unit_ids` (the JSONB array of units a
 * catalog item is offered in, which before D3 forced "which items are offered in
 * unit X?" to fetch-all + filter / `@>` containment).
 *
 * Derived projection, not an aggregate: no `version` / `aggregate_path` /
 * timestamps of its own. The TRUTH stays in the `catalog-item` reduced state
 * (`unitIds`, reducer untouched, ADR 0013 D3). The `catalog-item` projector
 * rewrites these rows in the SAME ACID tx as the parent upsert (delete-then-
 * insert, so a shrunk array leaves no orphans). Replay reconstructs from the
 * array; write-derived, never read to rehydrate the aggregate.
 *
 * Org-scoped under RLS (org-only). Composite FKs (D2 pattern): `(org_id,
 * catalog_item_id) → catalog_items(org_id, id)` CASCADE; `(org_id, unit_id) →
 * units(org_id, id)` RESTRICT (a unit offering catalog items can't be
 * hard-deleted).
 */
export const catalogItemUnits = pgTable(
  'catalog_item_units',
  {
    orgId: text('org_id').notNull(),
    catalogItemId: text('catalog_item_id').notNull(),
    unitId: text('unit_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.catalogItemId, table.unitId] }),
    foreignKey({
      name: 'catalog_item_units_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'catalog_item_units_catalog_item_id_fk',
      columns: [table.orgId, table.catalogItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'catalog_item_units_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    // The index that pays for the join: the inverse query "items offered in unit X".
    index('catalog_item_units_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredCatalogItemUnitRow = typeof catalogItemUnits.$inferSelect
export type NewCatalogItemUnitRow = typeof catalogItemUnits.$inferInsert
