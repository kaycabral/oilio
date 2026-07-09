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

export const orders = pgTable(
  'orders',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    customerId: text('customer_id'),
    appointmentId: text('appointment_id'),

    status: text('status').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    paymentMethod: text('payment_method'),

    discountCents: bigint('discount_cents', { mode: 'number' }).notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),

    items: jsonb('items').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('orders_status_check', sql`${table.status} IN ('open', 'closed', 'cancelled')`),
    check(
      'orders_payment_method_check',
      sql`${table.paymentMethod} IS NULL OR ${table.paymentMethod} IN ('cash', 'credit_card', 'debit_card', 'pix')`,
    ),
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
    check('orders_discount_cents_nonneg', sql`${table.discountCents} >= 0`),
    check('orders_subtotal_cents_nonneg', sql`${table.subtotalCents} >= 0`),
    check('orders_total_cents_nonneg', sql`${table.totalCents} >= 0`),
    foreignKey({
      name: 'orders_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.orgId, table.id], name: 'orders_pkey' }),
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
    }).onDelete('set null'),
    index('orders_org_id_status_idx').on(table.orgId, table.status),
    index('orders_org_id_appointment_idx').on(table.orgId, table.appointmentId),
  ],
)

export type StoredOrderRow = typeof orders.$inferSelect
export type NewOrderRow = typeof orders.$inferInsert
