import { foreignKey, index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const memberOperationsPii = pgTable(
  'member_operations_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    taxIdentity: jsonb('tax_identity'),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'member_operations_pii_pkey' }),
    foreignKey({
      name: 'member_operations_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('member_operations_pii_org_id_idx').on(table.orgId),
  ],
)

export type StoredMemberOperationPiiRow = typeof memberOperationsPii.$inferSelect
export type NewMemberOperationPiiRow = typeof memberOperationsPii.$inferInsert
