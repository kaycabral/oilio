import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const orgs = pgTable(
  'orgs',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    name: text('name').notNull(),
    slug: text('slug').notNull(),
    vertical: text('vertical').notNull(),
    website: text('website'),
    ownerUserId: text('owner_user_id').notNull(),

    branding: jsonb('branding').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId], name: 'orgs_pkey' }),
    check(
      'orgs_vertical_check',
      sql`${table.vertical} IN ('barbershop', 'auto_wash', 'auto_detailing', 'other')`,
    ),
    check('orgs_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check('orgs_slug_nonempty', sql`char_length(btrim(${table.slug})) > 0`),
    check('orgs_owner_user_id_nonempty', sql`char_length(btrim(${table.ownerUserId})) > 0`),
    index('orgs_slug_idx').on(table.slug),
  ],
)

export type StoredOrgRow = typeof orgs.$inferSelect
export type NewOrgRow = typeof orgs.$inferInsert
