import type { FirestoreDoc } from '@/domain/effect'
import { CashMovement } from '@/domain/types/cash-movement'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `cash-movement` ES context (brief 0061 § Grupo A) —
 * maps the reduced `CashMovement` state onto the `cash_movements` typed table
 * whose conditional CHECK enforces the union shape (kind ⇒ direction + which
 * links exist). `upsert` decodes the untyped projection doc against the domain
 * `CashMovement` schema at this single driver boundary — schema-validated, so no
 * cast leaks into product code.
 *
 * The domain is a union discriminated by `kind`; each branch fixes the present
 * links. We flatten the union to columns and let the DB's conditional CHECK
 * govern which are NULL — the projector just passes through the decoded fields
 * (the union already guarantees, e.g., `expenseCategoryId` is null on a `sale`).
 * No JSONB: every field is a flat scalar.
 */

const decodeCashMovement = Schema.decodeUnknownSync(CashMovement)

/**
 * The ordered `cash_movements` column list — single source of truth for the
 * upsert placeholders and the E2E seed. Mirrors the `INSERT` placeholders 1:1.
 */
export const CASH_MOVEMENT_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'unit_id',
  'version',
  'kind',
  'direction',
  'amount_cents',
  'payment_method',
  'order_id',
  'expense_category_id',
  'description',
  'recorded_by_uid',
  'created_at',
] as const

/**
 * Map a decoded `CashMovement` (+ aggregate path and version) onto the ordered
 * column VALUES — the inverse of `rowToDoc`, shared by the runtime projector and
 * the E2E seed. Order matches `CASH_MOVEMENT_COLUMNS`. The union's non-present
 * links are already `null` on the decoded value, so they pass straight through;
 * `payment_method` exists only on `sale`/`sale_reversal`.
 */
export function cashMovementColumnValues(
  m: CashMovement,
  aggregatePath: string,
  version: number,
): unknown[] {
  const paymentMethod = m.kind === 'sale' || m.kind === 'sale_reversal' ? m.paymentMethod : null
  return [
    aggregatePath,
    m.orgId,
    m.id,
    m.unitId,
    version,
    m.kind,
    m.direction,
    m.amountCents,
    paymentMethod,
    m.orderId,
    m.expenseCategoryId,
    m.description,
    m.recordedByUid,
    m.createdAt,
  ]
}

const PLACEHOLDERS = CASH_MOVEMENT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = CASH_MOVEMENT_COLUMNS.filter((col) => col !== 'aggregate_path')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO cash_movements (${CASH_MOVEMENT_COLUMNS.join(', ')})
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
  const m = decodeCashMovement(state)
  await client.query(UPSERT, cashMovementColumnValues(m, aggregatePath, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type CashMovementRow = {
  org_id: string
  id: string
  unit_id: string
  version: string | number
  kind: 'sale' | 'sale_reversal' | 'sangria' | 'suprimento' | 'despesa'
  direction: 'in' | 'out'
  amount_cents: string | number
  payment_method: string | null
  order_id: string | null
  expense_category_id: string | null
  description: string | null
  recorded_by_uid: string
  created_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`); `_version` re-attached so the event store versions/replays
// correctly. `bigint` columns come back as strings from `pg` — coerced to number.
// The decoded union shape is preserved: a `sale`/`sale_reversal` row keeps its
// `payment_method`, the other kinds keep it `null` (matching the union member).
export function rowToDoc(row: CashMovementRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    kind: row.kind,
    direction: row.direction,
    amountCents: Number(row.amount_cents),
    paymentMethod: row.payment_method,
    description: row.description,
    orderId: row.order_id,
    expenseCategoryId: row.expense_category_id,
    recordedByUid: row.recorded_by_uid,
    // `created_at` is `timestamptz` (brief 0068 D1): the pg driver returns a
    // `Date` on the raw `SELECT *` read. Normalize to ISO; domain stays `string`.
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<CashMovementRow>(
    'SELECT * FROM cash_movements WHERE aggregate_path = $1',
    [aggregatePath],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM cash_movements WHERE aggregate_path = $1', [aggregatePath])
}

export const cashMovementProjector: TypedProjector = { read, upsert, delete: remove }

/**
 * `aggregate_type` for cash movements = the aggregate-type segment of the event-store
 * path (`orgs/{orgId}/cash_movements/{id}` → `cash_movements`).
 */
export const CASH_MOVEMENT_AGGREGATE_TYPE = 'cash_movements'

registerTypedProjector(CASH_MOVEMENT_AGGREGATE_TYPE, cashMovementProjector)
