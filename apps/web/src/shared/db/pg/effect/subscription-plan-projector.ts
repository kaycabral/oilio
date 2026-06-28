import { SubscriptionPlanConfig } from '@/domain/aggregates/subscription-plan/config'
import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { SubscriptionPlan } from '@/domain/types/subscription-plan'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `subscription-plan` context (brief 0060, Grupo B) —
 * plugged into the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `SubscriptionPlan`
 * schema (no PII — the full shape is stored). It lifts the union discriminant
 * (`usageLimit.kind`) to a column the DB constrains and keeps the variant body +
 * the optional scope rules + the coverage arrays in JSONB (mirrors the
 * catalog-item / unit union mapping — discriminant column + JSONB body). The DB
 * enforces the invariants — a violation rolls back event + projection together.
 */

const decodeSubscriptionPlan = Schema.decodeUnknownSync(SubscriptionPlan)

/**
 * The ordered `subscription_plans` column list — single source of truth for the
 * runtime upsert and the E2E seed (so the two writers can never drift). Mirrors
 * the `INSERT` placeholders 1:1.
 */
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
    // Optional scope rules — absent/null collapses to NULL (unrestricted). Arrays
    // stringified; structs passed raw (node-pg encodes both for `jsonb`).
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

// ── Derived join tables (brief 0068 D3): plan ↔ item / category / unit-allowlist ─
// The N:N arrays (`includedItemIds`/`includedCategoryIds`/`unitAllowlist`) stay in
// the reduced state (reducer untouched); the projector mirrors them into
// relational rows in the SAME tx (the `org-projector` public-directory pattern).
// Delete-then-insert keeps replay/edit idempotent — a shrunk array leaves no
// orphan rows. The SQL + value-builders are exported so any seed writing
// `subscription_plans` directly stays in lockstep and never drifts. Mirrors the
// LIVE plan definition only — the frozen `subscriptions.plan` snapshot (ADR 0010)
// is never mirrored.
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

// `unitAllowlist` is nullable: null/absent = no restriction → ZERO rows. Only a
// present, non-null array materializes rows.
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
  // Mirror the N:N arrays into the join tables (same tx). Delete-then-insert so a
  // shrunk array leaves no orphans and replay is idempotent.
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

// Row shape the typed table stores; mapped back to the reducer's doc on read.
// `usage_limit` JSONB carries the full union body (the discriminant is also
// lifted to `usage_limit_kind`, but the body is authoritative on read). The
// optional scope-rule JSONB columns are null when unrestricted.
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

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). The optional scope rules are re-attached ONLY when present (a NULL
// column round-trips to the field being absent — the create-omits semantics of
// `unitAllowlist`/`allowedTimeScope`/`bookingLimits`). `_version` is re-attached.
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

// Locked read for the price/availability guard (brief 0033 AC-08): `FOR UPDATE`
// holds the plan row until the guarded append's tx ends, so a concurrent
// reprice/discontinuation can't let two appends snapshot a stale plan price.
async function readForUpdate(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<SubscriptionPlanRow>(
    'SELECT * FROM subscription_plans WHERE org_id = $1 AND id = $2 FOR UPDATE',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  // Drop the join rows explicitly (the parent FK is ON DELETE cascade, so this is
  // defensive + mirrors `member-operation-projector`'s join cleanup). The ref carries
  // the org + id directly.
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

/**
 * `aggregate_type` for subscription plans = the typed `AggregateType` literal
 * (`config.type`, singular `subscription_plan`) — D6 (ADR 0013). The Postgres
 * Layer routes by the ref's `type`, so registration and routing agree on this
 * literal.
 */
export const SUBSCRIPTION_PLAN_AGGREGATE_TYPE = SubscriptionPlanConfig.type

registerTypedProjector(SUBSCRIPTION_PLAN_AGGREGATE_TYPE, subscriptionPlanProjector)
