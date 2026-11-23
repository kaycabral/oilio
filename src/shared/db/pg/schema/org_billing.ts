import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const orgBilling = pgTable(
  'org_billing',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    tier: text('tier').notNull(),
    status: text('status').notNull(),
    billingCycle: text('billing_cycle'),
    unitQuantity: integer('unit_quantity').notNull().default(1),

    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, mode: 'string' }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId], name: 'org_billing_pkey' }),
    check('org_billing_tier_check', sql`${table.tier} IN ('free', 'pro', 'advanced')`),
    check(
      'org_billing_status_check',
      sql`${table.status} IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')`,
    ),
    check(
      'org_billing_cycle_check',
      sql`${table.billingCycle} IS NULL OR ${table.billingCycle} IN ('monthly', 'annual')`,
    ),
    check('org_billing_unit_quantity_nonneg', sql`${table.unitQuantity} >= 0`),
    uniqueIndex('org_billing_stripe_customer_idx')
      .on(table.stripeCustomerId)
      .where(sql`${table.stripeCustomerId} IS NOT NULL`),
    uniqueIndex('org_billing_stripe_subscription_idx')
      .on(table.stripeSubscriptionId)
      .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
  ],
)

export const orgBillingStripeIndex = pgTable('org_billing_stripe_index', {
  stripeCustomerId: text('stripe_customer_id').primaryKey(),
  orgId: text('org_id').notNull(),
})

export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
})

export type StoredOrgBillingRow = typeof orgBilling.$inferSelect
export type NewOrgBillingRow = typeof orgBilling.$inferInsert
export type StoredOrgBillingStripeIndexRow = typeof orgBillingStripeIndex.$inferSelect
export type StoredStripeWebhookEventRow = typeof stripeWebhookEvents.$inferSelect
