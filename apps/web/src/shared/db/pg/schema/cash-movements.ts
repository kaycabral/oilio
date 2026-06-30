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
import { units } from './units'

/**
 * Typed relational projection for the `cash-movement` Event-Sourced aggregate
 * (migration feature E, brief 0061 § Grupo A). Append-only ledger: the single
 * `cash_movement.created` event materializes the whole row; there is no
 * transition (the reducer has one case). The projection upsert runs in the SAME
 * ACID transaction as the event append — a rollback leaves zero rows in both.
 *
 * The domain is a union discriminated by `kind` (brief 0031/0015): each kind
 * fixes the `direction` sign and which links exist. We map the union to a single
 * table with a conditional CHECK (the catalog-item pattern), refused at the DB:
 *   - `kind ∈ {sale, sale_reversal, sangria, suprimento, despesa}`.
 *   - `direction ∈ {in, out}`, and the sign is fixed per kind:
 *       sale/suprimento → in · sale_reversal/sangria/despesa → out.
 *   - `sale`/`sale_reversal` carry `order_id` (NOT NULL) and may carry a
 *     `payment_method`; `expense_category_id` is NULL.
 *   - `despesa` carries `expense_category_id` (nullable) and no `order_id`/method.
 *   - `sangria`/`suprimento` carry no links (all NULL).
 *   - `amount_cents` ≥ 0 — always positive; `direction` carries the sign.
 *   - `org_id` NOT NULL leading column — every movement is org-scoped (RLS).
 *
 * No JSONB: every field of the union is a flat scalar, so the conditional CHECK
 * fully governs the shape without an opaque composite column.
 */
export const cashMovements = pgTable(
  'cash_movements',
  {
    // ── Identity + org/unit scope ───────────────────────────────────────────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── Discriminant + sign ─────────────────────────────────────────────────
    kind: text('kind').notNull(),
    direction: text('direction').notNull(),

    // ── Amount (always positive; `direction` carries the sign) ──────────────
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    // ── Conditional links (NULL unless the kind carries them, via CHECK) ────
    paymentMethod: text('payment_method'),
    orderId: text('order_id'),
    expenseCategoryId: text('expense_category_id'),

    description: text('description'),
    recordedByUid: text('recorded_by_uid').notNull(),
    // `timestamptz` (brief 0068 D1): ISO UTC instant; `mode:'string'` keeps the
    // domain `string`, the projector's `rowToDoc` normalizes the raw read.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Composite (org_id, id) PRIMARY KEY — the natural key.
    primaryKey({ columns: [table.orgId, table.id], name: 'cash_movements_pkey' }),
    // The discriminant, refused at the DB.
    check(
      'cash_movements_kind_check',
      sql`${table.kind} IN ('sale', 'sale_reversal', 'sangria', 'suprimento', 'despesa')`,
    ),
    check('cash_movements_direction_check', sql`${table.direction} IN ('in', 'out')`),
    // Always positive — `direction` carries the sign.
    check('cash_movements_amount_cents_nonneg', sql`${table.amountCents} >= 0`),
    // The cash-movement author (global uid, no FK — `users` is org-neutral):
    // non-empty so `''` can't blind the cash audit (#1283 / brief 0078 AC-09).
    check(
      'cash_movements_recorded_by_uid_nonempty',
      sql`char_length(btrim(${table.recordedByUid})) > 0`,
    ),
    // Union shape (brief 0031/0015): each kind fixes its direction and which
    // links exist. Mirrors the domain `Schema.Union` discriminated by `kind`.
    check(
      'cash_movements_kind_shape',
      sql`(
        ${table.kind} = 'sale'
        AND ${table.direction} = 'in'
        AND ${table.orderId} IS NOT NULL
        AND ${table.expenseCategoryId} IS NULL
      ) OR (
        ${table.kind} = 'sale_reversal'
        AND ${table.direction} = 'out'
        AND ${table.orderId} IS NOT NULL
        AND ${table.expenseCategoryId} IS NULL
      ) OR (
        ${table.kind} = 'despesa'
        AND ${table.direction} = 'out'
        AND ${table.orderId} IS NULL
        AND ${table.paymentMethod} IS NULL
      ) OR (
        ${table.kind} = 'sangria'
        AND ${table.direction} = 'out'
        AND ${table.orderId} IS NULL
        AND ${table.paymentMethod} IS NULL
        AND ${table.expenseCategoryId} IS NULL
      ) OR (
        ${table.kind} = 'suprimento'
        AND ${table.direction} = 'in'
        AND ${table.orderId} IS NULL
        AND ${table.paymentMethod} IS NULL
        AND ${table.expenseCategoryId} IS NULL
      )`,
    ),
    // Every movement belongs to a real org.
    foreignKey({
      name: 'cash_movements_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Cross-aggregate composite FKs (org-scoped).
    foreignKey({
      name: 'cash_movements_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'cash_movements_order_id_fk',
      columns: [table.orgId, table.orderId],
      foreignColumns: [orders.orgId, orders.id],
      // The migration authors this as `SET NULL (order_id)` (column-list form,
      // PG15+) so only the ref is nulled, never the NOT-NULL `org_id` (a bare
      // composite SET NULL → 23502). DEFERRABLE INITIALLY DEFERRED added in the
      // migration. See migration 0016 header.
    }).onDelete('set null'),
    // Cash reports filter+sort by org then recency (createdAt is ISO, sorts lexically).
    index('cash_movements_org_id_created_at_idx').on(table.orgId, table.createdAt),
    // Reconcile sale/reversal movements back to their order.
    index('cash_movements_org_id_order_idx').on(table.orgId, table.orderId),
  ],
)

export type StoredCashMovementRow = typeof cashMovements.$inferSelect
export type NewCashMovementRow = typeof cashMovements.$inferInsert
