import { foreignKey, index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const unitTaxIdentity = pgTable(
  'unit_tax_identity',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    taxIdentity: jsonb('tax_identity'),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'unit_tax_identity_pkey' }),
    foreignKey({
      name: 'unit_tax_identity_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('unit_tax_identity_org_id_idx').on(table.orgId),
  ],
)

export type StoredUnitTaxIdentityRow = typeof unitTaxIdentity.$inferSelect
export type NewUnitTaxIdentityRow = typeof unitTaxIdentity.$inferInsert
