import { foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { orgs } from './orgs'
import { units } from './units'

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
    index('catalog_item_units_org_id_unit_id_idx').on(table.orgId, table.unitId),
  ],
)

export type StoredCatalogItemUnitRow = typeof catalogItemUnits.$inferSelect
export type NewCatalogItemUnitRow = typeof catalogItemUnits.$inferInsert
