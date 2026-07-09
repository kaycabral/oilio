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
import { units } from './units'

export const memberships = pgTable(
  'memberships',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    userId: text('user_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    role: text('role').notNull(),
    status: text('status').notNull(),
    rlsUnitScope: text('rls_unit_scope'),
    invitedBy: text('invited_by'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'string' }).notNull(),

    permissions: jsonb('permissions').notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'memberships_pkey' }),
    check(
      'memberships_role_check',
      sql`${table.role} IN ('owner', 'manager', 'member_operator', 'receptionist')`,
    ),
    check(
      'memberships_status_check',
      sql`${table.status} IN ('active', 'invited', 'suspended', 'revoked')`,
    ),
    check('memberships_user_id_nonempty', sql`char_length(btrim(${table.userId})) > 0`),
    foreignKey({
      name: 'memberships_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'memberships_rls_unit_scope_fk',
      columns: [table.orgId, table.rlsUnitScope],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('set null'),
    index('memberships_org_id_user_id_idx').on(table.orgId, table.userId),
    index('memberships_user_id_idx').on(table.userId),
  ],
)

export type StoredMembershipRow = typeof memberships.$inferSelect
export type NewMembershipRow = typeof memberships.$inferInsert
