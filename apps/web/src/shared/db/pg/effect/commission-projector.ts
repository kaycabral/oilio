import type { FirestoreDoc } from '@/domain/effect'
import { Commission, liquidationStatusOf } from '@/domain/types/commission'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `commission` ES context (brief 0061 § Grupo A) — maps
 * the reduced `Commission` state onto the `commissions` typed table whose
 * invariants the DB enforces (liquidation enum, paid-IFF-pago, non-negative
 * money). `upsert` decodes the untyped projection doc against the domain
 * `Commission` schema at this single driver boundary — schema-validated, so no
 * cast leaks into product code (same pattern as catalog-item).
 *
 * A commission is a flat append-only ledger row, so there is no JSONB column —
 * every field maps to a real column the DB constrains. The optional domain
 * fields (`liquidationStatus`/`paidAt`/`paymentProof`) are normalized on write:
 * a legacy commission without `liquidationStatus` reads as `pendente`
 * (`liquidationStatusOf`), so the column is never NULL and the paid-IFF-pago
 * CHECK always has a definite truth value.
 */

const decodeCommission = Schema.decodeUnknownSync(Commission)

/**
 * The ordered `commissions` column list — single source of truth for the upsert
 * placeholders and the E2E seed, so a new column is added in ONE place and the
 * two writers can never drift. Mirrors the `INSERT` placeholders 1:1.
 */
export const COMMISSION_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'version',
  'order_id',
  'order_item_id',
  'attributed_user_id',
  'attributed_member_name',
  'item_kind',
  'item_name',
  'item_total_cents',
  'commission_kind',
  'commission_value',
  'amount_cents',
  'liquidation_status',
  'paid_at',
  'payment_proof',
  'created_at',
] as const

/**
 * Map a decoded `Commission` (+ its aggregate path and projection version) onto
 * the ordered `commissions` column VALUES — the inverse of `rowToDoc`, shared by
 * the runtime projector and the E2E seed so the two never diverge. Order matches
 * `COMMISSION_COLUMNS` exactly. The optional liquidation triple is normalized:
 * status defaults to `pendente` (legacy tolerance), and `paid_at`/`payment_proof`
 * are NULL unless present — keeping the paid-IFF-pago CHECK satisfiable.
 */
export function commissionColumnValues(
  c: Commission,
  aggregatePath: string,
  version: number,
): unknown[] {
  const status = liquidationStatusOf(c)
  return [
    aggregatePath,
    c.orgId,
    c.id,
    version,
    c.orderId,
    c.orderItemId,
    c.attributedUserId,
    c.attributedMemberName,
    c.itemKind,
    c.itemName,
    c.itemTotalCents,
    c.commissionKind,
    c.commissionValue,
    c.amountCents,
    status,
    status === 'pago' ? (c.paidAt ?? null) : null,
    c.paymentProof ?? null,
    c.createdAt,
  ]
}

const PLACEHOLDERS = COMMISSION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = COMMISSION_COLUMNS.filter((col) => col !== 'aggregate_path')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO commissions (${COMMISSION_COLUMNS.join(', ')})
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
  const c = decodeCommission(state)
  await client.query(UPSERT, commissionColumnValues(c, aggregatePath, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type CommissionRow = {
  org_id: string
  id: string
  version: string | number
  order_id: string
  order_item_id: string
  attributed_user_id: string
  attributed_member_name: string
  item_kind: 'service' | 'product'
  item_name: string
  item_total_cents: string | number
  commission_kind: 'percentage' | 'fixed'
  commission_value: string | number
  amount_cents: string | number
  liquidation_status: string
  paid_at: string | null
  payment_proof: string | null
  created_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`); `_version` is re-attached so the event store versions/replays
// correctly. `bigint` columns come back as strings from `pg` — coerced to number
// to match the domain shape. The optional liquidation triple is re-attached only
// when meaningful so a pending commission round-trips to the same shape (the
// domain refinement rejects `paidAt` on a pending commission).
export function rowToDoc(row: CommissionRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    orgId: row.org_id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    attributedUserId: row.attributed_user_id,
    attributedMemberName: row.attributed_member_name,
    itemKind: row.item_kind,
    itemName: row.item_name,
    itemTotalCents: Number(row.item_total_cents),
    commissionKind: row.commission_kind,
    commissionValue: Number(row.commission_value),
    amountCents: Number(row.amount_cents),
    liquidationStatus: row.liquidation_status,
    // `*_at` are `timestamptz` (brief 0068 D1): the pg driver returns a `Date`
    // on the raw `SELECT *` read. Normalize to ISO; the domain stays `string`.
    paidAt: row.paid_at == null ? null : new Date(row.paid_at).toISOString(),
    paymentProof: row.payment_proof,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<CommissionRow>(
    'SELECT * FROM commissions WHERE aggregate_path = $1',
    [aggregatePath],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM commissions WHERE aggregate_path = $1', [aggregatePath])
}

export const commissionProjector: TypedProjector = { read, upsert, delete: remove }

/**
 * `aggregate_type` for commissions = the aggregate-type segment of the event-store
 * path (`orgs/{orgId}/commissions/{id}` → `commissions`). The Postgres Layer
 * derives the same tag with `aggregateTypeOf`, so registration and routing agree.
 */
export const COMMISSION_AGGREGATE_TYPE = 'commissions'

registerTypedProjector(COMMISSION_AGGREGATE_TYPE, commissionProjector)
