import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { customers } from './customers'
import { orgs } from './orgs'
import { units } from './units'

export const subscriptions = pgTable(
  'subscriptions',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    customerId: text('customer_id').notNull(),
    customerUserId: text('customer_user_id'),

    status: text('status').notNull(),
    billingCycle: text('billing_cycle').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull(),
    nextChargeDate: timestamp('next_charge_date', { withTimezone: true, mode: 'string' }),
    pastDueCycles: bigint('past_due_cycles', { mode: 'number' }).notNull(),
    pastDueThreshold: bigint('past_due_threshold', { mode: 'number' }).notNull(),
    cancellationReason: text('cancellation_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),

    plan: jsonb('plan').notNull(),
    currentPeriod: jsonb('current_period').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check(
      'subscriptions_status_check',
      sql`${table.status} IN ('active', 'past_due', 'cancelled', 'cancelled_for_non_payment')`,
    ),
    check(
      'subscriptions_billing_cycle_check',
      sql`${table.billingCycle} IN ('monthly', 'quarterly', 'semiannual', 'annual')`,
    ),
    check('subscriptions_past_due_cycles_nonneg', sql`${table.pastDueCycles} >= 0`),
    check('subscriptions_past_due_threshold_nonneg', sql`${table.pastDueThreshold} >= 0`),
    check(
      'subscriptions_customer_user_id_nonempty',
      sql`${table.customerUserId} IS NULL OR char_length(btrim(${table.customerUserId})) > 0`,
    ),
    foreignKey({
      name: 'subscriptions_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.orgId, table.id], name: 'subscriptions_pkey' }),
    foreignKey({
      name: 'subscriptions_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'subscriptions_customer_id_fk',
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }).onDelete('restrict'),
    index('subscriptions_org_id_customer_idx').on(table.orgId, table.customerId),
    index('subscriptions_org_id_status_idx').on(table.orgId, table.status),
  ],
)

export type StoredSubscriptionRow = typeof subscriptions.$inferSelect
export type NewSubscriptionRow = typeof subscriptions.$inferInsert
