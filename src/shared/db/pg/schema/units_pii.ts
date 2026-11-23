import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const unitsPii = pgTable(
  'units_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    mobile: text('mobile').notNull(),
    email: text('email'),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'units_pii_pkey' }),
    foreignKey({
      name: 'units_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('units_pii_org_id_idx').on(table.orgId),
    check('units_pii_mobile_nonempty', sql`char_length(btrim(${table.mobile})) > 0`),
    check('units_pii_mobile_br_format', sql`${table.mobile} ~ '^55[0-9]{2}9[0-9]{8}$'`),
  ],
)

export type StoredUnitsPiiRow = typeof unitsPii.$inferSelect
export type NewUnitsPiiRow = typeof unitsPii.$inferInsert
