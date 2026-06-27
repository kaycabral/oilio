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

/**
 * Typed relational projection for the `org_billing` aggregate (brief 0071) — the
 * Assinatura Oilio: a Negócio's SaaS subscription to Oilio itself. CRUD mirror of
 * Stripe's ledger (Stripe is the system of record), NOT event-sourced truth.
 *
 * Keyed by single-column PK `org_id` — one billing row per Negócio (org_id == id,
 * the org is its own scope), the leading RLS column (policy filters
 * `org_id = current_setting('app.current_org')`, same shape as every typed table).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `tier ∈ {free, pro, advanced}` and `status ∈ {...}` as CHECKs (TEXT + CHECK,
 *     not pg enum, to stay aligned with the domain's `Schema.Literal` — ADR 0011 D3).
 *   - `billing_cycle ∈ {monthly, annual}` when present (null on free).
 *   - `unit_quantity >= 0`.
 *   - partial-UNIQUE on `stripe_customer_id` / `stripe_subscription_id` (a Stripe
 *     object maps to at most one Negócio).
 */
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

/**
 * Non-RLS lookup index `stripe_customer_id → org_id` (brief 0071, AC-04). The
 * Stripe webhook (feature E) has no session/org context, so it can't read the
 * RLS-guarded `org_billing` to resolve the org. It reads this tiny public-by-
 * contract table on the raw pool (mirrors `public_org_directory`/`listAllOrgIds`),
 * gets the orgId, then writes via `emitEvent` (which sets the RLS GUC from the
 * ref). Carries ONLY the id mapping — no operational/billing data.
 */
export const orgBillingStripeIndex = pgTable('org_billing_stripe_index', {
  stripeCustomerId: text('stripe_customer_id').primaryKey(),
  orgId: text('org_id').notNull(),
})

export type StoredOrgBillingRow = typeof orgBilling.$inferSelect
export type NewOrgBillingRow = typeof orgBilling.$inferInsert
export type StoredOrgBillingStripeIndexRow = typeof orgBillingStripeIndex.$inferSelect
