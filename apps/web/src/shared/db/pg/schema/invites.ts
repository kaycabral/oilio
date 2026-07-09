import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { orgs } from './orgs'

export const invites = pgTable(
  'invites',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status').notNull(),
    invitedBy: text('invited_by').notNull(),
    acceptedByUid: text('accepted_by_uid'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'invites_pkey' }),
    check(
      'invites_role_check',
      sql`${table.role} IN ('owner', 'manager', 'member_operator', 'receptionist')`,
    ),
    check(
      'invites_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'expired', 'revoked')`,
    ),
    check(
      'invites_acceptance_consistency',
      sql`(
        ${table.status} = 'accepted'
        AND ${table.acceptedByUid} IS NOT NULL
        AND ${table.acceptedAt} IS NOT NULL
      ) OR (
        ${table.status} = 'pending'
        AND ${table.acceptedByUid} IS NULL
        AND ${table.acceptedAt} IS NULL
      ) OR ${table.status} IN ('expired', 'revoked')`,
    ),
    foreignKey({
      name: 'invites_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('invites_org_id_status_idx').on(table.orgId, table.status),
  ],
)

export type StoredInviteRow = typeof invites.$inferSelect
export type NewInviteRow = typeof invites.$inferInsert
