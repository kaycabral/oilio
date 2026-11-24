import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const publicOrgDirectory = pgTable(
  'public_org_directory',
  {
    orgId: text('org_id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    vertical: text('vertical').notNull(),
    website: text('website'),
    ownerUserId: text('owner_user_id').notNull(),
    branding: jsonb('branding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('public_org_directory_slug_idx').on(table.slug)],
)

export type StoredPublicOrgDirectoryRow = typeof publicOrgDirectory.$inferSelect
export type NewPublicOrgDirectoryRow = typeof publicOrgDirectory.$inferInsert
