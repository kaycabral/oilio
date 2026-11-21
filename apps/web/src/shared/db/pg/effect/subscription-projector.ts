import type { AggregateRef, CollectionRef, QueryConstraint, StoredDoc } from '@/domain/effect'
import { Subscription } from '@/domain/types/subscription'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

export const SUBSCRIPTION_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'customer_id',
  'customer_user_id',
  'status',
  'billing_cycle',
  'cancel_at_period_end',
  'next_charge_date',
  'past_due_cycles',
  'past_due_threshold',
  'cancellation_reason',
  'cancelled_at',
  'plan',
  'current_period',
  'created_at',
  'updated_at',
] as const

export function subscriptionColumnValues(s: Subscription, version: number): unknown[] {
  return [
    s.orgId,
    s.id,
    s.unitId,
    version,
    s.customerId,
    s.customerUserId,
    s.status,
    s.plan.billingCycle,
    s.cancelAtPeriodEnd,
    s.nextChargeDate,
    s.pastDueCycles,
    s.pastDueThreshold,
    s.cancellationReason,
    s.cancelledAt,
    JSON.stringify(s.plan),
    JSON.stringify(s.currentPeriod),
    s.createdAt,
    s.updatedAt,
  ]
}

const PLACEHOLDERS = SUBSCRIPTION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = SUBSCRIPTION_COLUMNS.filter((col) => col !== 'org_id' && col !== 'id')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO subscriptions (${SUBSCRIPTION_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: StoredDoc): Promise<void> {
  const s = decodeSubscription(state)
  await client.query(UPSERT, subscriptionColumnValues(s, stateVersion(state)))
}

export type SubscriptionRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  customer_id: string
  customer_user_id: string | null
  status: string
  billing_cycle: string
  cancel_at_period_end: boolean
  next_charge_date: string | null
  past_due_cycles: string | number
  past_due_threshold: string | number
  cancellation_reason: string | null
  cancelled_at: string | null
  plan: unknown
  current_period: unknown
  created_at: string
  updated_at: string
}

export function rowToDoc(row: SubscriptionRow): StoredDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    customerId: row.customer_id,
    customerUserId: row.customer_user_id,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    nextChargeDate:
      row.next_charge_date == null ? null : new Date(row.next_charge_date).toISOString(),
    pastDueCycles: Number(row.past_due_cycles),
    pastDueThreshold: Number(row.past_due_threshold),
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at == null ? null : new Date(row.cancelled_at).toISOString(),
    plan: row.plan,
    currentPeriod: row.current_period,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM subscriptions WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<StoredDoc[]> {
  const tail = buildCollectionQueryTail(constraints, SUBSCRIPTION_COLUMNS, 2, true)
  const res = await client.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE org_id = $1${tail.sql}`,
    [ref.orgId, ...tail.params],
  )
  return res.rows.map(rowToDoc)
}

export const subscriptionProjector: TypedProjector = { read, upsert, delete: remove, list }

export const SUBSCRIPTION_AGGREGATE_TYPE = 'subscription'

registerTypedProjector(SUBSCRIPTION_AGGREGATE_TYPE, subscriptionProjector)
