import { SubscriptionPlanConfig } from '@/domain/aggregates/subscription-plan/config'
import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { SubscriptionPlan } from '@/domain/types/subscription-plan'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeSubscriptionPlan = Schema.decodeUnknownSync(SubscriptionPlan)

export const SUBSCRIPTION_PLAN_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'name',
  'description',
  'price_cents',
  'billing_cycle',
  'active',
  'archived_at',
  'usage_limit_kind',
  'usage_limit',
  'included_item_ids',
  'included_category_ids',
  'unit_allowlist',
  'allowed_time_scope',
  'booking_limits',
  'created_at',
  'updated_at',
] as const

export function subscriptionPlanColumnValues(
  plan: SubscriptionPlan,
  lastEventVersion: number,
): unknown[] {
  return [
    plan.orgId,
    plan.id,
    lastEventVersion,
    plan.name,
    plan.description,
    plan.priceCents,
    plan.billingCycle,
    plan.active,
    plan.archivedAt,
    plan.usageLimit.kind,
    plan.usageLimit,
    JSON.stringify(plan.includedItemIds),
    JSON.stringify(plan.includedCategoryIds),
    plan.unitAllowlist == null ? null : JSON.stringify(plan.unitAllowlist),
    plan.allowedTimeScope ?? null,
    plan.bookingLimits ?? null,
    plan.createdAt,
    plan.updatedAt,
  ]
}

const PLACEHOLDERS = SUBSCRIPTION_PLAN_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = SUBSCRIPTION_PLAN_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO subscription_plans (${SUBSCRIPTION_PLAN_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

export const PLAN_INCLUDED_ITEMS_DELETE =
  'DELETE FROM plan_included_items WHERE org_id = $1 AND plan_id = $2'
export const PLAN_INCLUDED_ITEMS_INSERT =
  'INSERT INTO plan_included_items (org_id, plan_id, item_id) VALUES ($1, $2, $3)'
export const PLAN_INCLUDED_CATEGORIES_DELETE =
  'DELETE FROM plan_included_categories WHERE org_id = $1 AND plan_id = $2'
export const PLAN_INCLUDED_CATEGORIES_INSERT =
  'INSERT INTO plan_included_categories (org_id, plan_id, category_id) VALUES ($1, $2, $3)'
export const PLAN_UNIT_ALLOWLIST_DELETE =
  'DELETE FROM plan_unit_allowlist WHERE org_id = $1 AND plan_id = $2'
export const PLAN_UNIT_ALLOWLIST_INSERT =
  'INSERT INTO plan_unit_allowlist (org_id, plan_id, unit_id) VALUES ($1, $2, $3)'

export function planIncludedItemRows(plan: SubscriptionPlan): unknown[][] {
  return plan.includedItemIds.map((itemId) => [plan.orgId, plan.id, itemId])
}

export function planIncludedCategoryRows(plan: SubscriptionPlan): unknown[][] {
  return plan.includedCategoryIds.map((categoryId) => [plan.orgId, plan.id, categoryId])
}

export function planUnitAllowlistRows(plan: SubscriptionPlan): unknown[][] {
  if (plan.unitAllowlist == null) return []
  return plan.unitAllowlist.map((unitId) => [plan.orgId, plan.id, unitId])
}

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const plan = decodeSubscriptionPlan(state)
  await client.query(UPSERT, subscriptionPlanColumnValues(plan, stateVersion(state)))
  await client.query(PLAN_INCLUDED_ITEMS_DELETE, [plan.orgId, plan.id])
  for (const row of planIncludedItemRows(plan)) {
    await client.query(PLAN_INCLUDED_ITEMS_INSERT, row)
  }
  await client.query(PLAN_INCLUDED_CATEGORIES_DELETE, [plan.orgId, plan.id])
  for (const row of planIncludedCategoryRows(plan)) {
    await client.query(PLAN_INCLUDED_CATEGORIES_INSERT, row)
  }
  await client.query(PLAN_UNIT_ALLOWLIST_DELETE, [plan.orgId, plan.id])
  for (const row of planUnitAllowlistRows(plan)) {
    await client.query(PLAN_UNIT_ALLOWLIST_INSERT, row)
  }
}

export type SubscriptionPlanRow = {
  org_id: string
  id: string
  last_event_version: string | number
  name: string
  description: string | null
  price_cents: string | number
  billing_cycle: string
  active: boolean
  archived_at: string | null
  usage_limit_kind: string
  usage_limit: unknown
  included_item_ids: unknown
  included_category_ids: unknown
  unit_allowlist: unknown
  allowed_time_scope: unknown
  booking_limits: unknown
  created_at: string
  updated_at: string
}

export function rowToDoc(row: SubscriptionPlanRow): FirestoreDoc {
  const base = {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    priceCents: Number(row.price_cents),
    billingCycle: row.billing_cycle,
    active: row.active,
    archivedAt: row.archived_at == null ? null : new Date(row.archived_at).toISOString(),
    usageLimit: row.usage_limit,
    includedItemIds: row.included_item_ids,
    includedCategoryIds: row.included_category_ids,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
  return {
    ...base,
    ...(row.unit_allowlist === null ? {} : { unitAllowlist: row.unit_allowlist }),
    ...(row.allowed_time_scope === null ? {} : { allowedTimeScope: row.allowed_time_scope }),
    ...(row.booking_limits === null ? {} : { bookingLimits: row.booking_limits }),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<SubscriptionPlanRow>(
    'SELECT * FROM subscription_plans WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function readForUpdate(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<SubscriptionPlanRow>(
    'SELECT * FROM subscription_plans WHERE org_id = $1 AND id = $2 FOR UPDATE',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query(PLAN_INCLUDED_ITEMS_DELETE, [ref.orgId, ref.id])
  await client.query(PLAN_INCLUDED_CATEGORIES_DELETE, [ref.orgId, ref.id])
  await client.query(PLAN_UNIT_ALLOWLIST_DELETE, [ref.orgId, ref.id])
  await client.query('DELETE FROM subscription_plans WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
}

export const subscriptionPlanProjector: TypedProjector = {
  read,
  readForUpdate,
  upsert,
  delete: remove,
}

export const SUBSCRIPTION_PLAN_AGGREGATE_TYPE = SubscriptionPlanConfig.type

registerTypedProjector(SUBSCRIPTION_PLAN_AGGREGATE_TYPE, subscriptionPlanProjector)
