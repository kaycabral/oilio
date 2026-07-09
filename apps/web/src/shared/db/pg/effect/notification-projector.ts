import { NotificationConfig } from '@/domain/aggregates/notification/config'
import { NotificationState } from '@/domain/aggregates/notification/types'
import type { AggregateRef, CollectionRef, FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeNotificationState = Schema.decodeUnknownSync(NotificationState)

export const NOTIFICATION_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'type',
  'source',
  'event_key',
  'customer_id',
  'appointment_id',
  'subscription_id',
  'read_at',
  'dispatched_at',
  'valid_until',
  'snoozed_until',
  'payload',
  'dispatch',
  'created_at',
  'updated_at',
] as const

function asState(state: FirestoreDoc): NotificationState {
  return decodeNotificationState(state)
}

export function notificationColumnValues(
  state: FirestoreDoc,
  ref: AggregateRef,
  version: number,
): unknown[] {
  const n = asState(state)
  const dispatch =
    n.dispatchedChannel === null && n.dispatchedBody === null
      ? null
      : { dispatchedChannel: n.dispatchedChannel, dispatchedBody: n.dispatchedBody }
  return [
    ref.orgId,
    ref.id,
    n.unitId,
    version,
    n.type,
    n.source,
    n.eventKey,
    n.customerId,
    n.appointmentId,
    n.subscriptionId,
    n.readAt,
    n.dispatchedAt,
    n.validUntil,
    n.snoozedUntil,
    n.payload,
    dispatch,
    n.createdAt,
    n.createdAt,
  ]
}

const PLACEHOLDERS = NOTIFICATION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = NOTIFICATION_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO notifications (${NOTIFICATION_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  await client.query(UPSERT, notificationColumnValues(state, ref, stateVersion(state)))
}

export type NotificationRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  type: string
  source: string
  event_key: string
  customer_id: string | null
  appointment_id: string | null
  subscription_id: string | null
  read_at: string | null
  dispatched_at: string | null
  valid_until: string | null
  snoozed_until: string | null
  payload: Record<string, unknown>
  dispatch: { dispatchedChannel: string | null; dispatchedBody: string | null } | null
  created_at: string | null
  updated_at: string | null
}

export function rowToDoc(row: NotificationRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    type: row.type,
    source: row.source,
    eventKey: row.event_key,
    customerId: row.customer_id,
    appointmentId: row.appointment_id,
    subscriptionId: row.subscription_id,
    payload: row.payload,
    readAt: row.read_at == null ? null : new Date(row.read_at).toISOString(),
    dispatchedAt: row.dispatched_at == null ? null : new Date(row.dispatched_at).toISOString(),
    dispatchedChannel: row.dispatch?.dispatchedChannel ?? null,
    dispatchedBody: row.dispatch?.dispatchedBody ?? null,
    validUntil: row.valid_until == null ? null : new Date(row.valid_until).toISOString(),
    snoozedUntil: row.snoozed_until == null ? null : new Date(row.snoozed_until).toISOString(),
    createdAt: row.created_at == null ? null : new Date(row.created_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<NotificationRow>(
    'SELECT * FROM notifications WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM notifications WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const tail = buildCollectionQueryTail(constraints, NOTIFICATION_COLUMNS, 2, true)
  const res = await client.query<NotificationRow>(
    `SELECT * FROM notifications WHERE org_id = $1${tail.sql}`,
    [ref.orgId, ...tail.params],
  )
  return res.rows.map(rowToDoc)
}

export const notificationProjector: TypedProjector = { read, upsert, delete: remove, list }

export const NOTIFICATION_AGGREGATE_TYPE = NotificationConfig.type

registerTypedProjector(NOTIFICATION_AGGREGATE_TYPE, notificationProjector)
