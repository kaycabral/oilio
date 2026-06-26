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

/**
 * Typed relational projection for the `subscription` Event-Sourced aggregate
 * (brief 0061 § Grupo B) — 11 event types, reconstructed by replay. The
 * projection upsert runs in the SAME ACID transaction as the event append; the
 * create-subscription+charge saga shares the tx with the charge write (AC-02),
 * so a subscription is never orphaned of its charge on the failure path.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `status ∈ {pending, active, past_due, suspended, cancelled,
 *     cancelled_for_non_payment}` — the lifecycle enum, refused at the DB.
 *   - `billing_cycle ∈ {monthly, quarterly, semiannual, annual}` — extracted
 *     from the plan snapshot as a discriminant column (CHECK), so the billing
 *     cadence is queryable + constrained, not buried in JSONB.
 *   - `org_id` NOT NULL leading column — every subscription is org-scoped (RLS).
 *   - counters (`past_due_cycles`/`past_due_threshold`) ≥ 0.
 *
 * The plan SNAPSHOT (`plan`) and the rolling period (`current_period`) are
 * composite/structural state — the plan carries a discriminated `usageLimit`
 * union and optional time/booking scopes — so they live in JSONB, faithful to
 * the reduced state without inventing relational shape (the catalog-item
 * pattern). `billing_cycle` is lifted to a column because it's a primary-metric
 * discriminant; the rest of the plan stays in the snapshot.
 *
 * snapshot-on-use (ADR 0010): the plan snapshot freezes the plan's terms at
 * subscription time — editing the plan definition never retroacts. PII (ADR 0010
 * D2): `customer_id`/`customer_user_id` are id-refs only.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    // ── Identity + org/unit scope ───────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── References (PII by id-ref; ADR 0010 D2) ─────────────────────────────
    customerId: text('customer_id').notNull(),
    customerUserId: text('customer_user_id'),

    // ── Lifecycle + billing discriminant ────────────────────────────────────
    status: text('status').notNull(),
    billingCycle: text('billing_cycle').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull(),
    // `timestamptz` (brief 0068 D1): ISO UTC instant (coincides with
    // currentPeriod.endAt + 1 cycle); `mode:'string'` keeps the domain `string`,
    // the projector's `rowToDoc` normalizes the raw read. The rolling window in
    // `current_period` (JSONB) is unaffected — only scalar date columns migrate.
    nextChargeDate: timestamp('next_charge_date', { withTimezone: true, mode: 'string' }),
    pastDueCycles: bigint('past_due_cycles', { mode: 'number' }).notNull(),
    pastDueThreshold: bigint('past_due_threshold', { mode: 'number' }).notNull(),
    cancellationReason: text('cancellation_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),

    // ── Composite / structural state (JSONB) ────────────────────────────────
    // `plan` is the frozen plan snapshot (incl. the `usageLimit` union and the
    // optional time/booking scopes); `current_period` is the rolling window.
    plan: jsonb('plan').notNull(),
    currentPeriod: jsonb('current_period').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The lifecycle enum, refused at the DB.
    check(
      'subscriptions_status_check',
      sql`${table.status} IN ('pending', 'active', 'past_due', 'suspended', 'cancelled', 'cancelled_for_non_payment')`,
    ),
    // The billing-cadence discriminant, lifted from the plan snapshot.
    check(
      'subscriptions_billing_cycle_check',
      sql`${table.billingCycle} IN ('monthly', 'quarterly', 'semiannual', 'annual')`,
    ),
    // Non-negative counters.
    check('subscriptions_past_due_cycles_nonneg', sql`${table.pastDueCycles} >= 0`),
    check('subscriptions_past_due_threshold_nonneg', sql`${table.pastDueThreshold} >= 0`),
    // Every subscription belongs to a real org.
    foreignKey({
      name: 'subscriptions_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Composite (org_id, id) PRIMARY KEY — the target of cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'subscriptions_pkey' }),
    // Cross-aggregate composite FKs (org-scoped).
    foreignKey({
      name: 'subscriptions_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
      // `unit_id` is NOT NULL — a subscription is always unit-scoped, so RESTRICT
      // (not SET NULL): a unit with subscriptions can't be hard-deleted.
    }).onDelete('restrict'),
    foreignKey({
      name: 'subscriptions_customer_id_fk',
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }).onDelete('restrict'),
    // Find a customer's subscription(s) by org + status (the hot read path).
    index('subscriptions_org_id_customer_idx').on(table.orgId, table.customerId),
    index('subscriptions_org_id_status_idx').on(table.orgId, table.status),
  ],
)

export type StoredSubscriptionRow = typeof subscriptions.$inferSelect
export type NewSubscriptionRow = typeof subscriptions.$inferInsert
