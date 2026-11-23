import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const memberFunnelEvents = pgTable(
  'member_funnel_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    orgId: text('org_id').notNull(),
    actorId: text('actor_id'),
    memberUid: text('member_uid'),
    role: text('role'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'member_funnel_events_event_check',
      sql`${table.event} IN (
        'member_invite_issued',
        'member_invite_opened',
        'member_invite_accepted'
      )`,
    ),
    check(
      'member_funnel_events_role_check',
      sql`${table.role} IS NULL OR ${table.role} IN ('owner', 'manager', 'member_operator', 'receptionist')`,
    ),
    index('member_funnel_events_org_id_ts_idx').on(table.orgId, table.ts),
    index('member_funnel_events_event_ts_idx').on(table.event, table.ts),
  ],
)

export type StoredMemberFunnelEventRow = typeof memberFunnelEvents.$inferSelect
export type NewMemberFunnelEventRow = typeof memberFunnelEvents.$inferInsert
