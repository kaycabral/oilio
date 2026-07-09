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
import { orgs } from './orgs'

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    name: text('name').notNull(),
    description: text('description'),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    billingCycle: text('billing_cycle').notNull(),
    active: boolean('active').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),

    usageLimitKind: text('usage_limit_kind').notNull(),

    usageLimit: jsonb('usage_limit').notNull(),
    includedItemIds: jsonb('included_item_ids').notNull(),
    includedCategoryIds: jsonb('included_category_ids').notNull(),
    unitAllowlist: jsonb('unit_allowlist'),
    allowedTimeScope: jsonb('allowed_time_scope'),
    bookingLimits: jsonb('booking_limits'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('subscription_plans_name_nonempty', sql`char_length(btrim(${table.name})) > 0`),
    check('subscription_plans_price_cents_nonneg', sql`${table.priceCents} >= 0`),
    check(
      'subscription_plans_billing_cycle_check',
      sql`${table.billingCycle} IN ('monthly', 'quarterly', 'semiannual', 'annual')`,
    ),
    check(
      'subscription_plans_usage_limit_kind_check',
      sql`${table.usageLimitKind} IN ('unlimited', 'count')`,
    ),
    foreignKey({
      name: 'subscription_plans_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }),
    primaryKey({ columns: [table.orgId, table.id], name: 'subscription_plans_pkey' }),
    index('subscription_plans_org_id_name_idx').on(table.orgId, table.name),
  ],
)

export type StoredSubscriptionPlanRow = typeof subscriptionPlans.$inferSelect
export type NewSubscriptionPlanRow = typeof subscriptionPlans.$inferInsert
