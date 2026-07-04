import { OrgBillingConfig } from '@/domain/aggregates/org-billing/config'
import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { StoredOrgBilling } from '@/domain/types/org-billing'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `org_billing` aggregate (brief 0071) — the Assinatura
 * Oilio. `upsert` decodes the reduced state against `StoredOrgBilling` at this
 * single driver boundary (no cast leaks), maps it onto the `org_billing` columns
 * (enums as CHECK-constrained TEXT, the rest scalar), and — when a Stripe customer
 * is linked — mirrors `stripe_customer_id → org_id` into the non-RLS lookup index
 * in the SAME transaction so the webhook can resolve the org without a session.
 *
 * `org_id` equals the bare `id` (the Negócio is its own scope), so the RLS policy
 * (`org_id = current_setting('app.current_org')`) filters a single row.
 */

const decodeOrgBilling = Schema.decodeUnknownSync(StoredOrgBilling)

export const ORG_BILLING_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'tier',
  'status',
  'billing_cycle',
  'unit_quantity',
  'stripe_customer_id',
  'stripe_subscription_id',
  'current_period_end',
  'cancel_at_period_end',
  'created_at',
  'updated_at',
] as const

export function orgBillingColumnValues(b: StoredOrgBilling, lastEventVersion: number): unknown[] {
  return [
    b.orgId,
    b.id,
    lastEventVersion,
    b.tier,
    b.status,
    b.billingCycle ?? null,
    b.unitQuantity,
    b.stripeCustomerId ?? null,
    b.stripeSubscriptionId ?? null,
    b.currentPeriodEnd ?? null,
    b.cancelAtPeriodEnd,
    b.createdAt,
    b.updatedAt,
  ]
}

const PLACEHOLDERS = ORG_BILLING_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = ORG_BILLING_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO org_billing (${ORG_BILLING_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id) DO UPDATE SET ${CONFLICT_SET}
`

// Mirror stripe_customer_id → org_id into the non-RLS lookup index (same tx).
const STRIPE_INDEX_UPSERT = `
  INSERT INTO org_billing_stripe_index (stripe_customer_id, org_id)
  VALUES ($1, $2)
  ON CONFLICT (stripe_customer_id) DO UPDATE SET org_id = EXCLUDED.org_id
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  // Identity (`org_id`/`id`) comes from the REF, not the reduced state. The ref is
  // the canonical, always-present identity (it's the same value that set the GUC
  // `app.current_org` for this write), whereas `state.orgId` is reducible to '' when
  // the FIRST event is a partial `org_billing.updated` whose changes omit orgId (the
  // reducer starts from INITIAL_ORG_BILLING_STATE, orgId: ''). Projecting org_id = ''
  // is then refused by the org-isolation RLS WITH CHECK (org_id = current_org) — the
  // 500 that reddened the prod smoke. Sourcing identity from the ref makes an empty
  // org_id/id STRUCTURALLY impossible here, for every call-site, present and future —
  // no call-site has to remember to re-inject its own identity into the changes.
  const billing: StoredOrgBilling = {
    ...decodeOrgBilling(state),
    orgId: ref.orgId,
    id: ref.id,
  }
  await client.query(UPSERT, orgBillingColumnValues(billing, stateVersion(state)))
  if (billing.stripeCustomerId !== null) {
    await client.query(STRIPE_INDEX_UPSERT, [billing.stripeCustomerId, billing.orgId])
  }
}

export type OrgBillingRow = {
  org_id: string
  id: string
  last_event_version: string | number
  tier: string
  status: string
  billing_cycle: string | null
  unit_quantity: number
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

export function rowToDoc(row: OrgBillingRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    tier: row.tier,
    status: row.status,
    billingCycle: row.billing_cycle,
    unitQuantity: row.unit_quantity,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd:
      row.current_period_end === null ? null : new Date(row.current_period_end).toISOString(),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<OrgBillingRow>('SELECT * FROM org_billing WHERE org_id = $1', [
    ref.orgId,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM org_billing WHERE org_id = $1', [ref.orgId])
  await client.query('DELETE FROM org_billing_stripe_index WHERE org_id = $1', [ref.orgId])
}

export const orgBillingProjector: TypedProjector = { read, upsert, delete: remove }

export const ORG_BILLING_AGGREGATE_TYPE = OrgBillingConfig.type

registerTypedProjector(ORG_BILLING_AGGREGATE_TYPE, orgBillingProjector)
