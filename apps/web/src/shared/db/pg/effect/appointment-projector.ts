import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { Appointment } from '@/domain/types/appointment'
import { buildMemberIdUpsert } from '@/shared/db/pg/effect/member-id-upsert'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

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
    a.attribution === null ? null : JSON.stringify(a.attribution),
    a.createdAt,
    a.updatedAt,
  ]
}

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
