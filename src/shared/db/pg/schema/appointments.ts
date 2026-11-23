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
import { catalogItems } from './catalog-items'
import { customers } from './customers'
import { memberOperations } from './member_operations'
import { memberships } from './memberships'
import { orgs } from './orgs'
import { units } from './units'

export const appointments = pgTable(
  'appointments',
  {
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    memberOperationId: text('member_operation_id').notNull(),
    memberId: text('member_id').notNull(),
    customerId: text('customer_id').notNull(),
    serviceId: text('service_id').notNull(),
    customerUserId: text('customer_user_id').notNull(),
    memberOperatorUserId: text('member_operator_user_id'),

    startAt: timestamp('start_at', { withTimezone: true, mode: 'string' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status').notNull(),

    servicePriceCentsSnapshot: bigint('service_price_cents_snapshot', {
      mode: 'number',
    }).notNull(),
    serviceDurationMinutesSnapshot: bigint('service_duration_minutes_snapshot', {
      mode: 'number',
    }).notNull(),
    commissionSnapshot: jsonb('commission_snapshot'),
    cancellationPolicySnapshot: jsonb('cancellation_policy_snapshot'),

    tracking: jsonb('tracking'),

    attribution: jsonb('attribution'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'appointments_status_check',
      sql`${table.status} IN ('scheduled', 'completed', 'cancelled', 'no_show')`,
    ),
    check(
      'appointments_customer_user_id_nonempty',
      sql`char_length(btrim(${table.customerUserId})) > 0`,
    ),
    check('appointments_price_snapshot_nonneg', sql`${table.servicePriceCentsSnapshot} >= 0`),
    check(
      'appointments_duration_snapshot_nonneg',
      sql`${table.serviceDurationMinutesSnapshot} >= 0`,
    ),
    foreignKey({
      name: 'appointments_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.orgId, table.id], name: 'appointments_pkey' }),
    foreignKey({
      name: 'appointments_unit_id_fk',
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_member_operation_id_fk',
      columns: [table.orgId, table.memberOperationId],
      foreignColumns: [memberOperations.orgId, memberOperations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_member_id_fk',
      columns: [table.orgId, table.memberId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_customer_id_fk',
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_service_id_fk',
      columns: [table.orgId, table.serviceId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }).onDelete('restrict'),
    index('appointments_org_id_unit_id_start_idx').on(table.orgId, table.unitId, table.startAt),
    index('appointments_org_id_member_operation_idx').on(table.orgId, table.memberOperationId),
    index('appointments_org_id_member_id_idx').on(table.orgId, table.memberId),
  ],
)

export type StoredAppointmentRow = typeof appointments.$inferSelect
export type NewAppointmentRow = typeof appointments.$inferInsert
