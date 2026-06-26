import type { FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { Subscription } from '@/domain/types/subscription'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `subscription` ES context (brief 0061 § Grupo B). The
 * scalar lifecycle fields are real columns the DB constrains (status enum,
 * billing-cycle enum lifted from the plan snapshot, non-negative counters); the
 * `plan` snapshot (with its `usageLimit` union + optional scopes) and the
 * `currentPeriod` window are composite/structural, so they live in JSONB. The
 * `upsert` decodes the untyped projection doc against the domain `Subscription`
 * schema at this single driver boundary — schema-validated, no cast.
 */

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

/** Ordered `subscriptions` column list — single source of truth for upsert + seed. */
export const SUBSCRIPTION_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'unit_id',
  'version',
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

/**
 * Map a decoded `Subscription` onto the ordered column VALUES (inverse of
 * `rowToDoc`). `billing_cycle` is lifted from the plan snapshot to its column;
 * `plan` and `current_period` are stringified for their JSONB columns.
 */
export function subscriptionColumnValues(
  s: Subscription,
  aggregatePath: string,
  version: number,
): unknown[] {
  return [
    aggregatePath,
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
const CONFLICT_SET = SUBSCRIPTION_COLUMNS.filter((col) => col !== 'aggregate_path')
  .map((col) => `${col} = EXCLUDED.${col}`)
  .join(', ')
const UPSERT = `
  INSERT INTO subscriptions (${SUBSCRIPTION_COLUMNS.join(', ')})
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
  const s = decodeSubscription(state)
  await client.query(UPSERT, subscriptionColumnValues(s, aggregatePath, stateVersion(state)))
}

export type SubscriptionRow = {
  org_id: string
  id: string
  unit_id: string
  version: string | number
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

// Reconstructs the reducer's doc from the typed row. `billing_cycle` is NOT
// re-attached at top level — it lives inside the `plan` snapshot (JSONB), which
// round-trips whole; the column is a derived discriminant for querying only.
export function rowToDoc(row: SubscriptionRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    customerId: row.customer_id,
    customerUserId: row.customer_user_id,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    // `*_at`/`next_charge_date` are `timestamptz` (brief 0068 D1): the pg driver
    // returns a `Date` on the raw `SELECT *` read. Normalize to ISO; the domain
    // stays `string`. `current_period` (JSONB) is untouched — its instants live
    // inside the document, not as scalar columns.
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

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE aggregate_path = $1',
    [aggregatePath],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM subscriptions WHERE aggregate_path = $1', [aggregatePath])
}

// Org-scoped collection scan (`orgs/{orgId}/subscriptions`): the daily cron reads
// the active/past_due subscriptions (`where status in [...]`) to emit expiry touches.
async function list(
  client: PoolClient,
  collectionPath: string,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const orgId = collectionPath.split('/')[1] ?? ''
  const tail = buildCollectionQueryTail(constraints, SUBSCRIPTION_COLUMNS, 2, true)
  const res = await client.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE org_id = $1${tail.sql}`,
    [orgId, ...tail.params],
  )
  return res.rows.map(rowToDoc)
}

export const subscriptionProjector: TypedProjector = { read, upsert, delete: remove, list }

export const SUBSCRIPTION_AGGREGATE_TYPE = 'subscriptions'

registerTypedProjector(SUBSCRIPTION_AGGREGATE_TYPE, subscriptionProjector)
