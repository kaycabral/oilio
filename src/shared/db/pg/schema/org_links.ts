import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const orgLinks = pgTable(
  'org_links',
  {
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'org_links_pkey', columns: [table.userId, table.orgId] }),
    index('org_links_user_id_idx').on(table.userId),
  ],
)

export type StoredOrgLinkRow = typeof orgLinks.$inferSelect
export type NewOrgLinkRow = typeof orgLinks.$inferInsert
