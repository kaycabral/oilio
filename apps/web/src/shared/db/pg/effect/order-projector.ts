import type { FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { Order } from '@/domain/types/order'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `order` (comanda) ES context (brief 0061 § Grupo A) —
 * maps the reduced `Order` state onto the `orders` typed table whose conditional
 * CHECK enforces the status union (open/closed/cancelled ⇒ closedAt/payment
 * shape). `upsert` decodes the untyped projection doc against the domain `Order`
 * schema at this single driver boundary — schema-validated, so no cast leaks
 * into product code.
 *
 * `items[]` (the per-item snapshot composite) is a structural field, not a
 * primary-metric invariant, so it lives in JSONB — faithful to the reduced state
 * without inventing relational shape. The scalar invariants (status, totals,
 * payment method) are real columns the DB constrains. `customer_id` is an
 * id-ref only (ADR 0010 D2: PII stays in the apagável `users/` doc).
 */

const decodeOrder = Schema.decodeUnknownSync(Order)

/**
 * The ordered `orders` column list — single source of truth for the upsert
 * placeholders and the E2E seed. Mirrors the `INSERT` placeholders 1:1.
 */
export const ORDER_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'unit_id',
  'version',
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

/**
 * Map a decoded `Order` (+ aggregate path and version) onto the ordered column
 * VALUES — the inverse of `rowToDoc`, shared by the runtime projector and the
 * E2E seed. Order matches `ORDER_COLUMNS`. `items` is `JSON.stringify`'d for the
 * JSONB column; `closedAt`/`paymentMethod` are null on a non-closed order (the
 * union guarantees it, and the DB CHECK refuses otherwise).
 */
export function orderColumnValues(order: Order, aggregatePath: string, version: number): unknown[] {
  return [
    aggregatePath,
    order.orgId,
    order.id,
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
const CONFLICT_SET = ORDER_COLUMNS.filter((col) => col !== 'aggregate_path')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO orders (${ORDER_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (aggregate_path) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(
  client: PoolClient,
  aggregatePath: string,
  state: FirestoreDoc,
): Promise<void> {
  const order = decodeOrder(state)
  await client.query(UPSERT, orderColumnValues(order, aggregatePath, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type OrderRow = {
  org_id: string
  id: string
  unit_id: string
  version: string | number
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

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`); `_version` re-attached so the event store versions/replays
// correctly. `bigint` columns come back as strings from `pg` — coerced to number.
// `items` is JSONB → already parsed by `pg`. The status-discriminated fields
// (`closedAt`/`paymentMethod`) round-trip per the union member (a non-closed
// order keeps them `null`, matching the open/cancelled branch).
export function rowToDoc(row: OrderRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    customerId: row.customer_id,
    appointmentId: row.appointment_id,
    status: row.status,
    // `*_at` are `timestamptz` (brief 0068 D1): the pg driver returns a `Date`
    // on the raw `SELECT *` read. Normalize to ISO; the domain stays `string`.
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

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<OrderRow>('SELECT * FROM orders WHERE aggregate_path = $1', [
    aggregatePath,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM orders WHERE aggregate_path = $1', [aggregatePath])
}

// Org-scoped collection scan (`orgs/{orgId}/orders`): the hourly cron reads the
// open orders (`where status == 'open'`) to flag stale ones.
async function list(
  client: PoolClient,
  collectionPath: string,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const orgId = collectionPath.split('/')[1] ?? ''
  const tail = buildCollectionQueryTail(constraints, ORDER_COLUMNS, 2, true)
  const res = await client.query<OrderRow>(`SELECT * FROM orders WHERE org_id = $1${tail.sql}`, [
    orgId,
    ...tail.params,
  ])
  return res.rows.map(rowToDoc)
}

export const orderProjector: TypedProjector = { read, upsert, delete: remove, list }

/**
 * `aggregate_type` for orders = the aggregate-type segment of the event-store path
 * (`orgs/{orgId}/orders/{id}` → `orders`).
 */
export const ORDER_AGGREGATE_TYPE = 'orders'

registerTypedProjector(ORDER_AGGREGATE_TYPE, orderProjector)
