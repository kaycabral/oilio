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

/**
 * Typed relational projection for the `charge` Event-Sourced aggregate (brief
 * 0061 § Grupo B). A charge is the billing record of a subscription period —
 * flat scalars only (no composite state), so every field maps to a real column
 * the DB constrains. The projection upsert runs in the SAME ACID transaction as
 * the event append; under the create-subscription+charge saga it shares the tx
 * with the subscription write (AC-02).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `status ∈ {scheduled, paid, failed, recovering, refunded, cancelled}` —
 *     the lifecycle enum, refused at the DB.
 *   - `amount_cents` ≥ 0 — no negative money.
 *   - `attempts` ≥ 0.
 *   - `org_id` NOT NULL leading column — every charge is org-scoped (RLS).
 *
 * PII (ADR 0010 D2): `customer_id` is an id-ref only — the customer's PII lives
 * in the apagável `users/` doc, never in this projection.
 *
 * The external payment gateway stays deferred (brief 0061 § Ramo paralelo): when
 * it lands, charging is non-transactional I/O and needs an outbox. This typed
 * table does not foreclose that — it stores the charge record; the outbox would
 * be a separate intent table written in the same tx. Modeling the charge as a
 * plain record (not assuming every effect is transactional) keeps the door open
 * (AC-04).
 */
export const charges = pgTable(
  'charges',
  {
    // ── Identity + org/unit scope ───────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── References (PII by id-ref; ADR 0010 D2) ─────────────────────────────
    subscriptionId: text('subscription_id').notNull(),
    customerId: text('customer_id').notNull(),

    // ── Billing period + amount ─────────────────────────────────────────────
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    // `timestamptz` (brief 0068 D1): all charge instants are ISO UTC moments.
    // `mode:'string'` keeps the domain `string`; the projector's `rowToDoc`
    // normalizes the raw `SELECT *` read (the pg driver hands back a `Date`).
    periodStartAt: timestamp('period_start_at', { withTimezone: true, mode: 'string' }).notNull(),
    periodEndAt: timestamp('period_end_at', { withTimezone: true, mode: 'string' }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true, mode: 'string' }).notNull(),

    // ── Lifecycle ───────────────────────────────────────────────────────────
    status: text('status').notNull(),
    attempts: bigint('attempts', { mode: 'number' }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'string' }),
    failureReason: text('failure_reason'),
    // Non-null SSE status='refunded' (ADR 0016 D5) — enforced by the CHECK below.
    refundedAt: timestamp('refunded_at', { withTimezone: true, mode: 'string' }),
    lastActorUid: text('last_actor_uid'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The lifecycle enum, refused at the DB.
    check(
      'charges_status_check',
      sql`${table.status} IN ('scheduled', 'paid', 'failed', 'recovering', 'refunded', 'cancelled')`,
    ),
    // No negative money / attempts.
    check('charges_amount_cents_nonneg', sql`${table.amountCents} >= 0`),
    check('charges_attempts_nonneg', sql`${table.attempts} >= 0`),
    // State→timestamp invariants (ADR 0016 D2/D5): a paid charge has a paidAt,
    // a refunded charge has a refundedAt. The domain schema refines the same at
    // the decode boundary; the CHECK is the DB's last word (seed/import/replay
    // can't inject a paid charge with no payment date — cash regime disguised).
    check(
      'charges_paid_requires_paid_at',
      sql`${table.status} <> 'paid' OR ${table.paidAt} IS NOT NULL`,
    ),
    check(
      'charges_refunded_requires_refunded_at',
      sql`${table.status} <> 'refunded' OR ${table.refundedAt} IS NOT NULL`,
    ),
    // Composite (org_id, id) PRIMARY KEY — the target of cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'charges_pkey' }),
    // Every charge belongs to a real org.
    foreignKey({
      name: 'charges_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Cross-aggregate composite FKs (org-scoped).
    foreignKey({
      name: 'charges_subscription_id_fk',
      columns: [table.orgId, table.subscriptionId],
      foreignColumns: [subscriptions.orgId, subscriptions.id],
      // `subscription_id` is NOT NULL — a charge is the billing record of a
      // subscription period, so RESTRICT (not SET NULL) keeps the link required.
      // DEFERRABLE INITIALLY DEFERRED added in the migration (the create
      // subscription+charge saga appends the charge before the subscription).
    }).onDelete('restrict'),
    foreignKey({
      name: 'charges_customer_id_fk',
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }).onDelete('restrict'),
    // The unit a charge belongs to (#1283 / brief 0078 AC-10). `charges` was the
    // only financial table missing `*_unit_id_fk` — every other (orders,
    // cash_movements, subscriptions, appointments) has it. The composite FK also
    // refuses a blank/non-existent unit_id, no separate CHECK needed.
    foreignKey({
      name: 'charges_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    // Charges of a subscription, by org.
    index('charges_org_id_subscription_idx').on(table.orgId, table.subscriptionId),
    // Charge lists/reports filter by org then status.
    index('charges_org_id_status_idx').on(table.orgId, table.status),
  ],
)

export type StoredChargeRow = typeof charges.$inferSelect
export type NewChargeRow = typeof charges.$inferInsert
