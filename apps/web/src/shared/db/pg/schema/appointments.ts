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

/**
 * Typed relational projection for the `appointment` Event-Sourced aggregate
 * (brief 0061 § Grupo C). The projection upsert runs in the SAME ACID
 * transaction as the event append; the identity↔financeiro sagas (offboard etc.)
 * share the tx with the membership/org writes (AC-03).
 *
 * Invariants enforced HERE (proven by integration against real Postgres):
 *   - `status ∈ {scheduled, completed, cancelled, no_show}` — the lifecycle
 *     enum, refused at the DB.
 *   - `org_id` NOT NULL leading column + `unit_id` NOT NULL — every appointment
 *     is org+unit-scoped. The RLS policy scopes BOTH (org always, unit when the
 *     session pins one), so `unit_id` is a real queryable column, not buried in
 *     JSONB (mirrors `units`/`memberships` from feature C).
 *   - the snapshotted price/duration are non-negative.
 *
 * Booking snapshots (price/duration/commission/cancellation-policy) are frozen
 * at commit time — editing the catalog item or the org policy never retroacts
 * (#875/#1038). The scalar snapshots (price/duration) are columns the DB
 * constrains; the composite snapshots (commission rule, cancellation policy) are
 * JSONB. The optional transition-tracking fields (cancel/reschedule/no-show
 * metadata) live in a single `tracking` JSONB blob — they are sparse and not
 * primary-metric invariants. PII (ADR 0010 D2): customer/memberOperation are
 * id-refs (`customer_id`/`customer_user_id`/`professional_*`), never inline PII.
 */
export const appointments = pgTable(
  'appointments',
  {
    // ── Identity + org/unit scope (unit_id drives the unit-scoped RLS) ──────
    orgId: text('org_id').notNull(),
    id: text('id').notNull(),
    unitId: text('unit_id').notNull(),

    // Monotonic projection version (the reducer's `_version`).
    lastEventVersion: bigint('last_event_version', { mode: 'number' }).notNull(),

    // ── References (PII by id-ref; ADR 0010 D2) ─────────────────────────────
    memberOperationId: text('member_operation_id').notNull(),
    // The membership whose member performed this appointment (brief 0076 AC-04).
    // The DIRECT history→membership reference: `(org_id, member_id) → memberships`
    // with `onDelete: restrict`, so removing a membership that has appointment
    // history is refused by the DB (the baixa operacional is the `canBeBooked`
    // capability toggled off, not a delete). Distinct from `member_operation_id`
    // (FK → member_operations, the operational profile): the profile cascades when
    // the membership goes, but the history FK restricts — both coexist (ADR 0010
    // immutability). `member_id` is the membership doc id (`{org_id}_{userId}`),
    // derived in the projector from the operational profile's `member_id` (it does
    // NOT enter the event payload), so it is always consistent with the performer.
    memberId: text('member_id').notNull(),
    customerId: text('customer_id').notNull(),
    serviceId: text('service_id').notNull(),
    customerUserId: text('customer_user_id').notNull(),
    memberOperatorUserId: text('member_operator_user_id'),

    // ── Schedule + lifecycle ────────────────────────────────────────────────
    // `timestamptz` (not text): the anti-double-book GiST exclusion constraint
    // (`appointments_no_double_book`) needs a real `tstzrange` over these
    // columns. `mode:'string'` keeps the driver returning strings (not `Date`),
    // so `AppointmentRow.start_at/end_at` stay `string`; the projector's
    // `rowToDoc` normalizes the Postgres timestamp format back to ISO 8601 (the
    // domain `Appointment.startAt: Schema.String` contract) at the read boundary.
    startAt: timestamp('start_at', { withTimezone: true, mode: 'string' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status').notNull(),

    // ── Booking snapshots (frozen at commit) ────────────────────────────────
    servicePriceCentsSnapshot: bigint('service_price_cents_snapshot', {
      mode: 'number',
    }).notNull(),
    serviceDurationMinutesSnapshot: bigint('service_duration_minutes_snapshot', {
      mode: 'number',
    }).notNull(),
    // Composite snapshots (commission rule, cancellation policy) — JSONB,
    // nullable (the domain has them as NullOr).
    commissionSnapshot: jsonb('commission_snapshot'),
    cancellationPolicySnapshot: jsonb('cancellation_policy_snapshot'),

    // ── Transition tracking (sparse optional metadata) — single JSONB blob ──
    tracking: jsonb('tracking'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // The lifecycle enum, refused at the DB.
    check(
      'appointments_status_check',
      sql`${table.status} IN ('scheduled', 'completed', 'cancelled', 'no_show')`,
    ),
    // Non-negative snapshots.
    check('appointments_price_snapshot_nonneg', sql`${table.servicePriceCentsSnapshot} >= 0`),
    check(
      'appointments_duration_snapshot_nonneg',
      sql`${table.serviceDurationMinutesSnapshot} >= 0`,
    ),
    // Every appointment belongs to a real org.
    foreignKey({
      name: 'appointments_org_id_fk',
      columns: [table.orgId],
      foreignColumns: [orgs.orgId],
    }).onDelete('cascade'),
    // Composite (org_id, id) PRIMARY KEY — the natural key + target of
    // cross-aggregate composite FKs.
    primaryKey({ columns: [table.orgId, table.id], name: 'appointments_pkey' }),
    // Cross-aggregate composite FKs (org-scoped). `customer_user_id`/
    // `member_operator_user_id` are global userId snapshots (LGPD) — NOT FKs.
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
    // The DIRECT history → membership FK (brief 0076 AC-04): `onDelete: restrict`
    // refuses removing a membership that has appointment history, so the baixa is
    // the `canBeBooked` capability toggled off — never a delete (ADR 0010).
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
      // `service_id` is NOT NULL — RESTRICT (not SET NULL). The price/duration
      // snapshot is already frozen on the appointment row, but the service ref
      // itself is required, so a referenced catalog item can't be hard-deleted.
    }).onDelete('restrict'),
    // Agenda reads filter by org + unit, sorted by start time.
    index('appointments_org_id_unit_id_start_idx').on(table.orgId, table.unitId, table.startAt),
    // MemberOperation's agenda within an org.
    index('appointments_org_id_member_operation_idx').on(table.orgId, table.memberOperationId),
    // Supports the history → membership FK lookup + the delete-guard ("does this
    // membership have appointment history?").
    index('appointments_org_id_member_id_idx').on(table.orgId, table.memberId),
  ],
)

export type StoredAppointmentRow = typeof appointments.$inferSelect
export type NewAppointmentRow = typeof appointments.$inferInsert
