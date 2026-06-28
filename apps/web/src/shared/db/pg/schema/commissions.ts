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
import { orders } from './orders'
import { orgs } from './orgs'

/**
 * Typed relational projection for the `commission` Event-Sourced aggregate
 * (migration feature E, brief 0061 § Grupo A) — one of the 6 financial-core ES
 * contexts moved off the generic `projections` JSONB store onto a typed table
 * whose invariants the DATABASE enforces (the iniciativa's primary metric).
 *
 * Keyed by composite PK (org_id, id) so it lines up 1:1 with the event stream's
 * `aggregate_id` and the generic projection key — the typed projector and the
 * generic fallback share the routing seam. The
 * projection upsert runs in the SAME ACID transaction as the event append
 * (inherited from feature A), now over a typed table: a rollback leaves zero
 * rows in both.
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `liquidation_status ∈ {pendente, pago}` — the manual-settlement enum
 *     (brief 0022 #998), refused at the DB.
 *   - `item_kind ∈ {service, product}` — the order-item discriminant.
 *   - `commission_kind ∈ {percentage, fixed}` — the snapshotted rule kind.
 *   - `amount_cents` / `item_total_cents` ≥ 0 — no negative money.
 *   - `paid_at` present IFF `liquidation_status = 'pago'` — the domain refinement
 *     ("paidAt deve existir sse a comissão está paga") lifted to a CHECK so the
 *     bank refuses a paid-without-date / pending-with-date row.
 *   - `org_id` NOT NULL leading column — every commission is org-scoped (RLS).
 *
 * `attributed_member_name` is a snapshot column (brief 0041 AC-11: retention of
 * the membership link — survives offboarding/anonymization), not PII under the
 * ADR 0010 D2 contract (which governs CUSTOMER PII / right-to-erasure). There is
 * no composite/structural state on a commission, so no JSONB column is needed —
 * a commission is a flat append-only ledger row.
 */
export const commissions = pgTable(
  'commissions',
  {
    // ── Identity + org scope ────────────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Provenance (which order/item generated this commission) ──────────────
    orderId: text('order_id').notNull(),
    orderItemId: text('order_item_id').notNull(),

    // ── Attribution (the credited member) ───────────────────────────────────
    // `attributed_user_id` is the GLOBAL userId of the credited member (any
    // role can be commissioned), NOT a MemberOperation doc id. The member name is
    // SNAPSHOTTED at apuração so the report survives the member being revoked.
    attributedUserId: text('attributed_user_id').notNull(),
    attributedMemberName: text('attributed_member_name').notNull(),

    // ── Item snapshot ───────────────────────────────────────────────────────
    itemKind: text('item_kind').notNull(),
    itemName: text('item_name').notNull(),
    itemTotalCents: bigint('item_total_cents', { mode: 'number' }).notNull(),

    // ── Snapshotted rule + computed amount ──────────────────────────────────
    commissionKind: text('commission_kind').notNull(),
    commissionValue: bigint('commission_value', { mode: 'number' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    // ── Manual liquidation (brief 0022 #998) ────────────────────────────────
    liquidationStatus: text('liquidation_status').notNull(),
    // `timestamptz` (brief 0068 D1): ISO UTC instant; `mode:'string'` keeps the
    // domain `string`, the projector's `rowToDoc` normalizes the raw read.
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
    paymentProof: text('payment_proof'),

    // = order.closedAt
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Composite (org_id, id) PRIMARY KEY — the natural key.
    primaryKey({ columns: [table.orgId, table.id], name: 'commissions_pkey' }),
    // The liquidation enum, refused at the DB.
    check(
      'commissions_liquidation_status_check',
      sql`${table.liquidationStatus} IN ('pendente', 'pago')`,
    ),
    // The order-item discriminant.
    check('commissions_item_kind_check', sql`${table.itemKind} IN ('service', 'product')`),
    // The snapshotted rule kind.
    check(
      'commissions_commission_kind_check',
      sql`${table.commissionKind} IN ('percentage', 'fixed')`,
    ),
    // No negative money.
    check('commissions_amount_cents_nonneg', sql`${table.amountCents} >= 0`),
    check('commissions_item_total_cents_nonneg', sql`${table.itemTotalCents} >= 0`),
    // The domain refinement, at the DB: paid IFF it carries a paid date.
    check(
      'commissions_paid_at_iff_pago',
      sql`(${table.liquidationStatus} = 'pago') = (${table.paidAt} IS NOT NULL)`,
    ),
    // Every commission belongs to a real org.
    foreignKey({
      name: 'commissions_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Cross-aggregate composite FK (org-scoped). `attributed_user_id` is a global
    // userId snapshot (LGPD retention) — intentionally NOT an FK.
    foreignKey({
      name: 'commissions_order_id_fk',
      columns: [table.orgId, table.orderId],
      foreignColumns: [orders.orgId, orders.id],
      // `order_id` is NOT NULL — a commission always belongs to an order, so
      // RESTRICT (not SET NULL). DEFERRABLE INITIALLY DEFERRED added in the
      // migration (the close-order saga appends commissions before the order).
    }).onDelete('restrict'),
    // Reports group commissions by org then attributed member.
    index('commissions_org_id_attributed_user_idx').on(table.orgId, table.attributedUserId),
    // Reconcile/audit a commission back to its order.
    index('commissions_org_id_order_idx').on(table.orgId, table.orderId),
  ],
)

export type StoredCommissionRow = typeof commissions.$inferSelect
export type NewCommissionRow = typeof commissions.$inferInsert
