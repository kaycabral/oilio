import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { CashMovement } from '@/domain/types/cash-movement'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeCashMovement = Schema.decodeUnknownSync(CashMovement)

export const CASH_MOVEMENT_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
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

export function cashMovementColumnValues(
  m: CashMovement,
  ref: AggregateRef,
  version: number,
): unknown[] {
  const paymentMethod = m.kind === 'sale' || m.kind === 'sale_reversal' ? m.paymentMethod : null
  return [
    ref.orgId,
    ref.id,
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
const CONFLICT_SET = CASH_MOVEMENT_COLUMNS.filter((col) => col !== 'org_id' && col !== 'id')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO cash_movements (${CASH_MOVEMENT_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const m = decodeCashMovement(state)
  await client.query(UPSERT, cashMovementColumnValues(m, ref, stateVersion(state)))
}

export type CashMovementRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
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

export function rowToDoc(row: CashMovementRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
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
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<CashMovementRow>(
    'SELECT * FROM cash_movements WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM cash_movements WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
}

export const cashMovementProjector: TypedProjector = { read, upsert, delete: remove }

export const CASH_MOVEMENT_AGGREGATE_TYPE = 'cash_movement'

registerTypedProjector(CASH_MOVEMENT_AGGREGATE_TYPE, cashMovementProjector)
