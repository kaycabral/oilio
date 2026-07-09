import type { AggregateRef, CollectionRef, FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { Order } from '@/domain/types/order'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeOrder = Schema.decodeUnknownSync(Order)

export const ORDER_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'customer_id',
  'appointment_id',
  'status',
  'closed_at',
  'payment_method',
  'discount_cents',
  'subtotal_cents',
  'total_cents',
  'items',
  'created_at',
  'updated_at',
] as const

export function orderColumnValues(order: Order, ref: AggregateRef, version: number): unknown[] {
  return [
    ref.orgId,
    ref.id,
    order.unitId,
    version,
    order.customerId,
    order.appointmentId,
    order.status,
    order.closedAt,
    order.status === 'closed' ? order.paymentMethod : null,
    order.discountCents,
    order.subtotalCents,
    order.totalCents,
    JSON.stringify(order.items),
    order.createdAt,
    order.updatedAt,
  ]
}

const PLACEHOLDERS = ORDER_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = ORDER_COLUMNS.filter((col) => col !== 'org_id' && col !== 'id')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO orders (${ORDER_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const order = decodeOrder(state)
  await client.query(UPSERT, orderColumnValues(order, ref, stateVersion(state)))
}

export type OrderRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  customer_id: string | null
  appointment_id: string | null
  status: 'open' | 'closed' | 'cancelled'
  closed_at: string | null
  payment_method: string | null
  discount_cents: string | number
  subtotal_cents: string | number
  total_cents: string | number
  items: unknown
  created_at: string
  updated_at: string
}

export function rowToDoc(row: OrderRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    customerId: row.customer_id,
    appointmentId: row.appointment_id,
    status: row.status,
    closedAt: row.closed_at == null ? null : new Date(row.closed_at).toISOString(),
    paymentMethod: row.payment_method,
    discountCents: Number(row.discount_cents),
    subtotalCents: Number(row.subtotal_cents),
    totalCents: Number(row.total_cents),
    items: row.items,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<OrderRow>('SELECT * FROM orders WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM orders WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const tail = buildCollectionQueryTail(constraints, ORDER_COLUMNS, 2, true)
  const res = await client.query<OrderRow>(`SELECT * FROM orders WHERE org_id = $1${tail.sql}`, [
    ref.orgId,
    ...tail.params,
  ])
  return res.rows.map(rowToDoc)
}

export const orderProjector: TypedProjector = { read, upsert, delete: remove, list }

export const ORDER_AGGREGATE_TYPE = 'order'

registerTypedProjector(ORDER_AGGREGATE_TYPE, orderProjector)
