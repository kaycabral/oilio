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

export const notifications = pgTable(
  'notifications',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    type: text('type').notNull(),
    source: text('source').notNull(),
    eventKey: text('event_key').notNull(),

    customerId: text('customer_id'),
    appointmentId: text('appointment_id'),
    subscriptionId: text('subscription_id'),

    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'string' }),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'string' }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true, mode: 'string' }),

    payload: jsonb('payload').notNull(),
    dispatch: jsonb('dispatch'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'notifications_pkey' }),
    check(
      'notifications_type_check',
      sql`${table.type} IN (
        'birthday',
        'subscription_expiring_tomorrow',
        'subscription_expired',
        'subscription_overdue_followup',
        'order_stale',
        'cash_register_open',
        'new_customer',
        'payment_failure'
      )`,
    ),
    check('notifications_source_check', sql`${table.source} IN ('cron', 'event')`),
    check('notifications_unit_id_nonempty', sql`char_length(btrim(${table.unitId})) > 0`),
    foreignKey({
      name: 'notifications_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    index('notifications_org_id_unit_id_idx').on(table.orgId, table.unitId),
    index('notifications_org_id_event_key_idx').on(table.orgId, table.eventKey),
  ],
)

export type StoredNotificationRow = typeof notifications.$inferSelect
export type NewNotificationRow = typeof notifications.$inferInsert
