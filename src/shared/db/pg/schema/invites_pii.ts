import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const invitesPii = pgTable(
  'invites_pii',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    mobile: text('mobile').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'invites_pii_pkey' }),
    foreignKey({
      name: 'invites_pii_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('invites_pii_org_id_idx').on(table.orgId),
    check('invites_pii_mobile_nonempty', sql`char_length(btrim(${table.mobile})) > 0`),
    check('invites_pii_mobile_br_format', sql`${table.mobile} ~ '^55[0-9]{2}9[0-9]{8}$'`),
  ],
)

export type StoredInvitePiiRow = typeof invitesPii.$inferSelect
export type NewInvitePiiRow = typeof invitesPii.$inferInsert
