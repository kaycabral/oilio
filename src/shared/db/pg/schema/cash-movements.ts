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

export const cashMovements = pgTable(
  'cash_movements',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    kind: text('kind').notNull(),
    direction: text('direction').notNull(),

    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),

    paymentMethod: text('payment_method'),
    orderId: text('order_id'),
    expenseCategoryId: text('expense_category_id'),

    description: text('description'),
    recordedByUid: text('recorded_by_uid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id], name: 'cash_movements_pkey' }),
    check(
      'cash_movements_kind_check',
      sql`${table.kind} IN ('sale', 'sale_reversal', 'sangria', 'suprimento', 'despesa')`,
    ),
    check('cash_movements_direction_check', sql`${table.direction} IN ('in', 'out')`),
    check('cash_movements_amount_cents_nonneg', sql`${table.amountCents} >= 0`),
    check(
      'cash_movements_recorded_by_uid_nonempty',
      sql`char_length(btrim(${table.recordedByUid})) > 0`,
    ),
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
    foreignKey({
      name: 'cash_movements_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cash_movements_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'cash_movements_order_id_fk',
      columns: [table.orgId, table.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('set null'),
    index('cash_movements_org_id_created_at_idx').on(table.orgId, table.createdAt),
    index('cash_movements_org_id_order_idx').on(table.orgId, table.orderId),
  ],
)

export type StoredCashMovementRow = typeof cashMovements.$inferSelect
export type NewCashMovementRow = typeof cashMovements.$inferInsert
