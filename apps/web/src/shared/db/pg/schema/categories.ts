import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const categories = pgTable(
  'categories',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color'),
    active: boolean('active').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('categories_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    foreignKey({
      name: 'categories_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    primaryKey({ columns: [table.orgId, table.id], name: 'categories_pkey' }),
    index('categories_org_id_name_idx').on(table.orgId, table.name),
  ],
)

export type StoredCategoryRow = typeof categories.$inferSelect
export type NewCategoryRow = typeof categories.$inferInsert
