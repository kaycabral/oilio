import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const customers = pgTable(
  'customers',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    userId: text('user_id').notNull(),

    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'string' }),

    acquisition: jsonb('acquisition'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'customers_pkey' }),
    check('customers_user_id_nonempty', sql`char_length(btrim(${table.userId})) > 0`),
    foreignKey({
      name: 'customers_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('customers_org_id_user_id_idx').on(table.orgId, table.userId),
  ],
)

export type StoredCustomerRow = typeof customers.$inferSelect
export type NewCustomerRow = typeof customers.$inferInsert
