import type { AggregateRef, StoredDoc } from '@/domain/effect'
import { Commission, liquidationStatusOf } from '@/domain/types/commission'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeCommission = Schema.decodeUnknownSync(Commission)

export const COMMISSION_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
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

export function commissionColumnValues(
  c: Commission,
  ref: AggregateRef,
  version: number,
): unknown[] {
  const status = liquidationStatusOf(c)
  return [
    ref.orgId,
    ref.id,
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
const CONFLICT_SET = COMMISSION_COLUMNS.filter((col) => col !== 'org_id' && col !== 'id')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO commissions (${COMMISSION_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: StoredDoc): Promise<void> {
  const c = decodeCommission(state)
  await client.query(UPSERT, commissionColumnValues(c, ref, stateVersion(state)))
}

export type CommissionRow = {
  org_id: string
  id: string
  last_event_version: string | number
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

export function rowToDoc(row: CommissionRow): StoredDoc {
  return {
    _version: Number(row.last_event_version),
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
    paidAt: row.paid_at == null ? null : new Date(row.paid_at).toISOString(),
    paymentProof: row.payment_proof,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<CommissionRow>(
    'SELECT * FROM commissions WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM commissions WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const commissionProjector: TypedProjector = { read, upsert, delete: remove }

export const COMMISSION_AGGREGATE_TYPE = 'commission'

registerTypedProjector(COMMISSION_AGGREGATE_TYPE, commissionProjector)
