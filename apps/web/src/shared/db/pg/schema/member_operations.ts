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
import { memberships } from './memberships'
import { orgs } from './orgs'

export const memberOperations = pgTable(
  'member_operations',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    userId: text('user_id').notNull(),

    memberId: text('member_id').notNull(),

    defaultCommission: jsonb('default_commission'),
    unitIds: jsonb('unit_ids').notNull(),
    catalogServiceIds: jsonb('catalog_service_ids').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('member_operations_user_id_nonempty', sql`char_length(btrim(${table.userId})) > 0`),
    check('member_operations_member_id_nonempty', sql`char_length(btrim(${table.memberId})) > 0`),
    foreignKey({
      name: 'member_operations_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    foreignKey({
      name: 'member_operations_member_id_fk',
      columns: [table.orgId, table.memberId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.orgId, table.id], name: 'member_operations_pkey' }),
    index('member_operations_org_id_user_id_idx').on(table.orgId, table.userId),
    index('member_operations_org_id_member_id_idx').on(table.orgId, table.memberId),
  ],
)

export type StoredMemberOperationRow = typeof memberOperations.$inferSelect
export type NewMemberOperationRow = typeof memberOperations.$inferInsert
