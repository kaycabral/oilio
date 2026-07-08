import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { Charge } from '@/domain/types/charge'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `charge` ES context (brief 0061 § Grupo B). A charge is
 * flat (no composite state), so every field maps to a real column the DB
 * constrains (status enum, non-negative money). `upsert` decodes the untyped
 * projection doc against the domain `Charge` schema at this single driver
 * boundary — schema-validated, so no cast leaks into product code.
 */

const decodeCharge = Schema.decodeUnknownSync(Charge)

/** Ordered `charges` column list — single source of truth for upsert + seed. */
export const CHARGE_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'subscription_id',
  'customer_id',
  'amount_cents',
  'period_start_at',
  'period_end_at',
  'due_date',
  'status',
  'attempts',
  'paid_at',
  'failed_at',
  'failure_reason',
  'refunded_at',
  'last_actor_uid',
  'created_at',
  'updated_at',
] as const

/** Map a decoded `Charge` onto the ordered column VALUES (inverse of `rowToDoc`). */
export function chargeColumnValues(c: Charge, ref: AggregateRef, version: number): unknown[] {
  return [
    ref.orgId,
    ref.id,
    c.unitId,
    version,
    c.subscriptionId,
    c.customerId,
    c.amountCents,
    c.periodStartAt,
    c.periodEndAt,
    c.dueDate,
    c.status,
    c.attempts,
    c.paidAt,
    c.failedAt,
    c.failureReason,
    c.refundedAt,
    c.lastActorUid,
    c.createdAt,
    c.updatedAt,
  ]
}

const PLACEHOLDERS = CHARGE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = CHARGE_COLUMNS.filter((col) => col !== 'org_id' && col !== 'id')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO charges (${CHARGE_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const c = decodeCharge(state)
  await client.query(UPSERT, chargeColumnValues(c, ref, stateVersion(state)))
}

export type ChargeRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  subscription_id: string
  customer_id: string
  amount_cents: string | number
  period_start_at: string
  period_end_at: string
  due_date: string
  status: string
  attempts: string | number
  paid_at: string | null
  failed_at: string | null
  failure_reason: string | null
  refunded_at: string | null
  last_actor_uid: string | null
  created_at: string
  updated_at: string
}

export function rowToDoc(row: ChargeRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    subscriptionId: row.subscription_id,
    customerId: row.customer_id,
    amountCents: Number(row.amount_cents),
    // `*_at`/`due_date` are `timestamptz` (brief 0068 D1): the pg driver returns
    // a `Date` on the raw `SELECT *` read. Normalize to ISO (null-guarded for
    // the nullable ones); the domain stays `string`.
    periodStartAt: new Date(row.period_start_at).toISOString(),
    periodEndAt: new Date(row.period_end_at).toISOString(),
    dueDate: new Date(row.due_date).toISOString(),
    status: row.status,
    attempts: Number(row.attempts),
    paidAt: row.paid_at == null ? null : new Date(row.paid_at).toISOString(),
    failedAt: row.failed_at == null ? null : new Date(row.failed_at).toISOString(),
    failureReason: row.failure_reason,
    refundedAt: row.refunded_at == null ? null : new Date(row.refunded_at).toISOString(),
    lastActorUid: row.last_actor_uid,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<ChargeRow>('SELECT * FROM charges WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM charges WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const chargeProjector: TypedProjector = { read, upsert, delete: remove }

export const CHARGE_AGGREGATE_TYPE = 'charge'

registerTypedProjector(CHARGE_AGGREGATE_TYPE, chargeProjector)
