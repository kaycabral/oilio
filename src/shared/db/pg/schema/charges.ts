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
import { customers } from './customers'
import { orgs } from './orgs'
import { subscriptions } from './subscriptions'
import { units } from './units'

export const charges = pgTable(
  'charges',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    subscriptionId: text('subscription_id').notNull(),
    customerId: text('customer_id').notNull(),

    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    periodStartAt: timestamp('period_start_at', { withTimezone: true, mode: 'string' }).notNull(),
    periodEndAt: timestamp('period_end_at', { withTimezone: true, mode: 'string' }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true, mode: 'string' }).notNull(),

    status: text('status').notNull(),
    attempts: bigint('attempts', { mode: 'number' }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'string' }),
    failureReason: text('failure_reason'),
    refundedAt: timestamp('refunded_at', { withTimezone: true, mode: 'string' }),
    lastActorUid: text('last_actor_uid'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check(
      'charges_status_check',
      sql`${table.status} IN ('scheduled', 'paid', 'failed', 'recovering', 'refunded', 'cancelled')`,
    ),
    check('charges_amount_cents_nonneg', sql`${table.amountCents} >= 0`),
    check('charges_attempts_nonneg', sql`${table.attempts} >= 0`),
    check(
      'charges_paid_requires_paid_at',
      sql`${table.status} <> 'paid' OR ${table.paidAt} IS NOT NULL`,
    ),
    check(
      'charges_refunded_requires_refunded_at',
      sql`${table.status} <> 'refunded' OR ${table.refundedAt} IS NOT NULL`,
    ),
    primaryKey({ columns: [table.orgId, table.id], name: 'charges_pkey' }),
    foreignKey({
      name: 'charges_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'charges_subscription_id_fk',
      columns: [table.orgId, table.subscriptionId],
      foreignColumns: [subscriptions.orgId, subscriptions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'charges_customer_id_fk',
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'charges_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    index('charges_org_id_subscription_idx').on(table.orgId, table.subscriptionId),
    index('charges_org_id_status_idx').on(table.orgId, table.status),
  ],
)

export type StoredChargeRow = typeof charges.$inferSelect
export type NewChargeRow = typeof charges.$inferInsert
