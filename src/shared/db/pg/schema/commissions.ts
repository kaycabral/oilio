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

export const commissions = pgTable(
  'commissions',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    orderId: text('order_id').notNull(),
    orderItemId: text('order_item_id').notNull(),

    attributedUserId: text('attributed_user_id').notNull(),
    attributedMemberName: text('attributed_member_name').notNull(),

    itemKind: text('item_kind').notNull(),
    itemName: text('item_name').notNull(),
    itemTotalCents: bigint('item_total_cents', { mode: 'number' }).notNull(),

    commissionKind: text('commission_kind').notNull(),
    commissionValue: bigint('commission_value', { mode: 'number' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    liquidationStatus: text('liquidation_status').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
    paymentProof: text('payment_proof'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'commissions_pkey' }),
    check(
      'commissions_liquidation_status_check',
      sql`${table.liquidationStatus} IN ('pendente', 'pago')`,
    ),
    check('commissions_item_kind_check', sql`${table.itemKind} IN ('service', 'product')`),
    check(
      'commissions_commission_kind_check',
      sql`${table.commissionKind} IN ('percentage', 'fixed')`,
    ),
    check('commissions_amount_cents_nonneg', sql`${table.amountCents} >= 0`),
    check('commissions_item_total_cents_nonneg', sql`${table.itemTotalCents} >= 0`),
    check('commissions_order_item_id_nonempty', sql`char_length(btrim(${table.orderItemId})) > 0`),
    check(
      'commissions_attributed_user_id_nonempty',
      sql`char_length(btrim(${table.attributedUserId})) > 0`,
    ),
    check('commissions_item_name_nonempty', sql`char_length(btrim(${table.itemName})) > 0`),
    check(
      'commissions_paid_at_iff_pago',
      sql`(${table.liquidationStatus} = 'pago') = (${table.paidAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'commissions_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'commissions_order_id_fk',
      columns: [table.orgId, table.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('restrict'),
    index('commissions_org_id_attributed_user_idx').on(table.orgId, table.attributedUserId),
    index('commissions_org_id_order_idx').on(table.orgId, table.orderId),
  ],
)

export type StoredCommissionRow = typeof commissions.$inferSelect
export type NewCommissionRow = typeof commissions.$inferInsert
