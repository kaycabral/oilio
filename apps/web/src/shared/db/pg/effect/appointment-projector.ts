import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { Appointment } from '@/domain/types/appointment'
import { buildMemberIdUpsert } from '@/shared/db/pg/effect/member-id-upsert'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `appointment` ES context (brief 0061 § Grupo C). The
 * scalar fields + the price/duration snapshots are columns the DB constrains
 * (status enum, non-negative snapshots, org+unit scope); the composite snapshots
 * (commission rule, cancellation policy) and the sparse transition-tracking
 * metadata are JSONB. `upsert` decodes the untyped projection doc against the
 * domain `Appointment` schema at this single driver boundary — schema-validated,
 * no cast.
 */

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

// `member_id` (brief 0076 AC-04) is NOT in this placeholder list: it is DERIVED
// in the INSERT from the operational profile's `member_id` via a correlated
// subquery on `member_operation_id` (the FK guarantees the profile row exists in
// the same tx), so the direct history → membership reference is always consistent
// with the performer and never enters the event payload. See `UPSERT` below.
/** Ordered `appointments` placeholder column list — single source of truth for upsert + seed. */
export const APPOINTMENT_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'member_operation_id',
  'customer_id',
  'service_id',
  'customer_user_id',
  'member_operator_user_id',
  'start_at',
  'end_at',
  'status',
  'service_price_cents_snapshot',
  'service_duration_minutes_snapshot',
  'commission_snapshot',
  'cancellation_policy_snapshot',
  'tracking',
  'attribution',
  'created_at',
  'updated_at',
] as const

// The optional transition-tracking fields, bundled into the single `tracking`
// JSONB blob (sparse — most appointments carry none). Kept in one place so the
// column values and `rowToDoc` agree on which keys travel together.
const TRACKING_KEYS = [
  'cancelledAt',
  'cancelledBy',
  'cancelledNoticeMinutes',
  'rescheduledAt',
  'rescheduledBy',
  'rescheduledNoticeMinutes',
  'noShowMarkedAt',
  'noShowMarkedBy',
] as const

function pickTracking(a: Appointment): Record<string, unknown> {
  const tracking: Record<string, unknown> = {}
  for (const key of TRACKING_KEYS) {
    const value = a[key]
    if (value !== undefined) tracking[key] = value
  }
  return tracking
}

/** Map a decoded `Appointment` onto the ordered column VALUES (inverse of `rowToDoc`). */
export function appointmentColumnValues(
  a: Appointment,
  ref: AggregateRef,
  lastEventVersion: number,
): unknown[] {
  return [
    ref.orgId,
    ref.id,
    a.unitId,
    lastEventVersion,
    a.memberOperationId,
    a.customerId,
    a.serviceId,
    a.customerUserId,
    a.memberOperatorUserId,
    a.startAt,
    a.endAt,
    a.status,
    a.servicePriceCentsSnapshot,
    a.serviceDurationMinutesSnapshot,
    a.commissionSnapshot,
    a.cancellationPolicySnapshot,
    JSON.stringify(pickTracking(a)),
    // TOUCH attribution → JSONB (brief 0077 AC-11). Null stays null.
    a.attribution === null ? null : JSON.stringify(a.attribution),
    a.createdAt,
    a.updatedAt,
  ]
}

// `member_id` derived from the operational profile (brief 0076 AC-04): the
// membership the performer belongs to. The FK `member_operation_id →
// member_operations` (RESTRICT) guarantees the profile row exists in this tx, so
// the subquery always resolves; the result feeds the `appointments_member_id_fk`
// (RESTRICT) that refuses removing a membership with appointment history. Built by
// the shared `buildMemberIdUpsert` (same rule for agenda_blocks).
const UPSERT = buildMemberIdUpsert('appointments', APPOINTMENT_COLUMNS)

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const a = decodeAppointment(state)
  await client.query(UPSERT, appointmentColumnValues(a, ref, stateVersion(state)))
}

export type AppointmentRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  member_operation_id: string
  customer_id: string
  service_id: string
  customer_user_id: string
  member_operator_user_id: string | null
  start_at: string
  end_at: string
  status: string
  service_price_cents_snapshot: string | number
  service_duration_minutes_snapshot: string | number
  commission_snapshot: unknown
  cancellation_policy_snapshot: unknown
  tracking: unknown
  attribution: unknown
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's doc from the typed row. The `tracking` JSONB blob is
// spread back at top level so the optional fields round-trip to the same shape
// (an appointment without tracking spreads an empty object — no stray keys).
// Copies the known optional tracking keys out of the parsed JSONB blob, without
// asserting the blob's shape — an absent key is simply not copied, so an
// appointment without tracking round-trips with no stray keys (matching the
// domain's optional fields).
function trackingFromRow(blob: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (blob === null || typeof blob !== 'object') return out
  const record: Record<string, unknown> = { ...blob }
  for (const key of TRACKING_KEYS) {
    const value = record[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

export function rowToDoc(row: AppointmentRow): FirestoreDoc {
  const tracking = trackingFromRow(row.tracking)
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    memberOperationId: row.member_operation_id,
    customerId: row.customer_id,
    serviceId: row.service_id,
    customerUserId: row.customer_user_id,
    memberOperatorUserId: row.member_operator_user_id,
    // `start_at`/`end_at` are `timestamptz` columns (for the anti-double-book
    // exclusion constraint). With `mode:'string'` the pg driver returns the
    // Postgres timestamp format (`2026-06-10 14:00:00+00`), NOT ISO 8601 — the
    // domain `Appointment.startAt: Schema.String` and the lexicographic range
    // reads expect the ISO instant the writer stored. Normalize back to ISO at
    // this single read boundary so the projection round-trips exactly.
    startAt: new Date(row.start_at).toISOString(),
    endAt: new Date(row.end_at).toISOString(),
    status: row.status,
    servicePriceCentsSnapshot: Number(row.service_price_cents_snapshot),
    serviceDurationMinutesSnapshot: Number(row.service_duration_minutes_snapshot),
    commissionSnapshot: row.commission_snapshot,
    cancellationPolicySnapshot: row.cancellation_policy_snapshot,
    attribution: row.attribution ?? null,
    ...tracking,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<AppointmentRow>(
    'SELECT * FROM appointments WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM appointments WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const appointmentProjector: TypedProjector = { read, upsert, delete: remove }

export const APPOINTMENT_AGGREGATE_TYPE = 'appointment'

registerTypedProjector(APPOINTMENT_AGGREGATE_TYPE, appointmentProjector)
