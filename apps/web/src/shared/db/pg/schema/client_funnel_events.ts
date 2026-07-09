import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const clientFunnelEvents = pgTable(
  'client_funnel_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    event: text('event').notNull(),
    orgId: text('org_id').notNull(),
    unitId: text('unit_id'),
    actorId: text('actor_id'),
    customerId: text('customer_id'),
    intent: text('intent'),
    source: text('source'),
    medium: text('medium'),
    campaign: text('campaign'),
    fromInvite: text('from_invite'),
    fieldsFilled: jsonb('fields_filled'),

    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'client_funnel_events_event_check',
      sql`${table.event} IN (
        'client_invite_issued',
        'client_invite_opened',
        'client_signed_in',
        'client_profile_completed',
        'appointment_created'
      )`,
    ),
    check(
      'client_funnel_events_intent_check',
      sql`${table.intent} IS NULL OR ${table.intent} IN ('signup', 'booking')`,
    ),
    index('client_funnel_events_org_id_ts_idx').on(table.orgId, table.ts),
    index('client_funnel_events_event_ts_idx').on(table.event, table.ts),
  ],
)

export type StoredClientFunnelEventRow = typeof clientFunnelEvents.$inferSelect
export type NewClientFunnelEventRow = typeof clientFunnelEvents.$inferInsert
