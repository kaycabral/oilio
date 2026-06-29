import type { AggregateRef, CollectionRef, FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { StoredCustomer } from '@/domain/types/customer'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `customer` context (brief 0060, Grupo A) — plugged into
 * the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `StoredCustomer` schema
 * (the PII-omitted shape — name/whatsapp/email/birthDate/avatarUrl come live from
 * the global `users/{userId}` doc at read time). Only the operational fields
 * persist: the `user_id` link and the two distinct non-active markers
 * (`archived_at` LGPD block / `deactivated_at` operator removal). The DB enforces
 * the invariants — a violation rolls back event + projection together.
 */

const decodeCustomer = Schema.decodeUnknownSync(StoredCustomer)

/** The ordered `customers` column list — single source of truth for the runtime
 * upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1. */
export const CUSTOMER_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'user_id',
  'archived_at',
  'deactivated_at',
  'acquisition',
  'created_at',
  'updated_at',
] as const

export function customerColumnValues(
  customer: StoredCustomer,
  ref: AggregateRef,
  lastEventVersion: number,
): unknown[] {
  return [
    ref.orgId,
    ref.id,
    lastEventVersion,
    customer.userId,
    customer.archivedAt,
    customer.deactivatedAt,
    // Composite attribution → JSONB (mirrors the schema's JSONB for structural
    // state). Null stays null; a value is stringified for the bound param.
    customer.acquisition === null ? null : JSON.stringify(customer.acquisition),
    customer.createdAt,
    customer.updatedAt,
  ]
}

const PLACEHOLDERS = CUSTOMER_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = CUSTOMER_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO customers (${CUSTOMER_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const customer = decodeCustomer(state)
  await client.query(UPSERT, customerColumnValues(customer, ref, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type CustomerRow = {
  org_id: string
  id: string
  last_event_version: string | number
  user_id: string
  archived_at: string | null
  deactivated_at: string | null
  // JSONB — driver returns the parsed object (or null). Passed through to the
  // doc as-is; the `StoredCustomer` decode validates the shape on read.
  acquisition: unknown
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` is re-attached. PII is NOT present (merged from `users/`
// at read time).
export function rowToDoc(row: CustomerRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    archivedAt: row.archived_at == null ? null : new Date(row.archived_at).toISOString(),
    deactivatedAt: row.deactivated_at == null ? null : new Date(row.deactivated_at).toISOString(),
    acquisition: row.acquisition ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<CustomerRow>(
    'SELECT * FROM customers WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM customers WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

// Org-scoped collection scan (the `customer` collection for an org): the birthday
// cron sweeps the org's customers (no constraints) and joins each to its
// `users/{uid}` PII doc.
async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const tail = buildCollectionQueryTail(constraints, CUSTOMER_COLUMNS, 2, true)
  const res = await client.query<CustomerRow>(
    `SELECT * FROM customers WHERE org_id = $1${tail.sql}`,
    [ref.orgId, ...tail.params],
  )
  return res.rows.map(rowToDoc)
}

export const customerProjector: TypedProjector = { read, upsert, delete: remove, list }

export const CUSTOMER_AGGREGATE_TYPE = 'customer'

registerTypedProjector(CUSTOMER_AGGREGATE_TYPE, customerProjector)
