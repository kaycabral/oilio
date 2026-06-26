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
import { appointments } from './appointments'
import { customers } from './customers'
import { orgs } from './orgs'
import { units } from './units'

/**
 * Typed relational projection for the `order` (comanda) Event-Sourced aggregate
 * (migration feature E, brief 0061 § Grupo A). The projection covers the whole
 * operational order doc — items, discount, totals, status, timestamps — derived
 * only from events. The upsert runs in the SAME ACID transaction as the event
 * append (and, for the close cascade, in the SAME tx as the commission/cash
 * writes — feature E's saga-as-ACID), so a rollback leaves zero rows.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `status ∈ {open, closed, cancelled}` — the discriminant, refused at the DB.
 *   - `closed_at` is non-NULL IFF `status = 'closed'`, and `payment_method` may
 *     only exist on a closed order — the domain union invariant
 *     ("`closedAt` non-null SSE `closed`; `paymentMethod` only on closed") lifted
 *     to a conditional CHECK. "Open with closedAt", "closed without closedAt",
 *     "open/cancelled with payment" become unrepresentable at the DB.
 *   - `payment_method ∈ {cash, credit_card, debit_card, pix}` when present.
 *   - `subtotal_cents` / `total_cents` / `discount_cents` ≥ 0.
 *   - `org_id` NOT NULL leading column — every order is org-scoped (RLS).
 *
 * PII (ADR 0010 D2): `customer_id` is an id-ref only — the customer's PII lives
 * in the apagável `users/` doc, never in this projection (nor the event payload).
 * `items[]` is the per-item snapshot composite (refId/name/qty/unitPrice/
 * commission rule/attribution/coverage) — a faithful structural field, not a
 * primary-metric invariant — so it lives in JSONB (the catalog-item pattern).
 */
export const orders = pgTable(
  'orders',
  {
    // ── Identity + org/unit scope ───────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── References (PII by id-ref; ADR 0010 D2) ─────────────────────────────
    // `customer_id` may be null (anonymous walk-in sale). `appointment_id` links
    // a booking-born order back to its appointment.
    customerId: text('customer_id'),
    appointmentId: text('appointment_id'),

    // ── Status (discriminant) + close fields ────────────────────────────────
    status: text('status').notNull(),
    // `timestamptz` (brief 0068 D1): ISO UTC instant; `mode:'string'` keeps the
    // domain `string`, the projector's `rowToDoc` normalizes the raw read.
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    paymentMethod: text('payment_method'),

    // ── Money (cached totals; recomputed from items when needed) ─────────────
    discountCents: bigint('discount_cents', { mode: 'number' }).notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),

    // ── Item snapshots (composite/structural; JSONB) ────────────────────────
    items: jsonb('items').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The discriminant, refused at the DB.
    check('orders_status_check', sql`${table.status} IN ('open', 'closed', 'cancelled')`),
    // The payment-method enum, as a CHECK (when present).
    check(
      'orders_payment_method_check',
      sql`${table.paymentMethod} IS NULL OR ${table.paymentMethod} IN ('cash', 'credit_card', 'debit_card', 'pix')`,
    ),
    // The domain union invariant: closedAt non-NULL SSE closed; payment only on
    // closed (a fully subscription-covered close has total 0 → payment stays
    // nullable, but only a closed order may carry it).
    check(
      'orders_status_shape',
      sql`(
        ${table.status} = 'open'
        AND ${table.closedAt} IS NULL
        AND ${table.paymentMethod} IS NULL
      ) OR (
        ${table.status} = 'cancelled'
        AND ${table.closedAt} IS NULL
        AND ${table.paymentMethod} IS NULL
      ) OR (
        ${table.status} = 'closed'
        AND ${table.closedAt} IS NOT NULL
      )`,
    ),
    // No negative money.
    check('orders_discount_cents_nonneg', sql`${table.discountCents} >= 0`),
    check('orders_subtotal_cents_nonneg', sql`${table.subtotalCents} >= 0`),
    check('orders_total_cents_nonneg', sql`${table.totalCents} >= 0`),
    // Every order belongs to a real org.
    foreignKey({
      name: 'orders_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Composite (org_id, id) PRIMARY KEY — the natural key + target of
    // cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'orders_pkey' }),
    // Cross-aggregate composite FKs (org-scoped).
    foreignKey({
      name: 'orders_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'orders_customer_id_fk',
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'orders_appointment_id_fk',
      columns: [table.orgId, table.appointmentId],
      foreignColumns: [appointments.orgId, appointments.id],
      // The migration authors this as `SET NULL (appointment_id)` (column-list
      // form, PG15+) so only the dangling ref is nulled — a bare composite SET
      // NULL would null the NOT-NULL `org_id` (23502). drizzle 0.45 can't express
      // the form; see migration 0016 header for the rationale.
    }).onDelete('set null'),
    // Order lists/dashboards filter by org then status, sorted by recency.
    index('orders_org_id_status_idx').on(table.orgId, table.status),
    // Resolve the order an appointment closed into.
    index('orders_org_id_appointment_idx').on(table.orgId, table.appointmentId),
  ],
)

export type StoredOrderRow = typeof orders.$inferSelect
export type NewOrderRow = typeof orders.$inferInsert
