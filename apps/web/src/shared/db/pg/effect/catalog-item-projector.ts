import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import type { AggregateRef, CollectionRef, FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { CatalogItem, isCatalogProduct } from '@/domain/types/catalog-item'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `catalog_item` context (brief 0058, AC-01/AC-03) — the
 * first consumer of the per-context typed-projection mechanism.
 *
 * `upsert` decodes the reduced `state` (the untyped `FirestoreDoc` the reducer
 * projects) against the domain `CatalogItem` schema at this single driver
 * boundary — schema-validated, so no cast leaks into product code (same pattern
 * as the event-store replay decode). It then maps the typed item onto the
 * `catalog_items` columns: the primary-metric scalars (kind/name/price/visibility
 * /org) as real columns the DB constrains, and the composite/structural fields
 * (commission/unit_ids/unit_overrides/required_resources) as JSONB.
 *
 * `delete` drops the row by aggregate ref — driven by the backend-aware delete
 * helper on a hard-delete (the event store skips the projection write for
 * `*.deleted`).
 *
 * The DB enforces the invariants (CHECK/enum/NOT NULL): a write that violates one
 * (kind, blank name, negative price, bad visibility, wrong kind-shape) raises a
 * constraint error inside the transaction and rolls back event + projection
 * together — the pilot's proof that the database refuses bad data, not just the
 * app.
 */

const decodeCatalogItem = Schema.decodeUnknownSync(CatalogItem)

/**
 * The ordered `catalog_items` column list — the single source of truth for both
 * the runtime upsert and the E2E seed, so a new column is added in ONE place and
 * the two writers can never drift (the drift that silently dropped a seeded
 * field before). Mirrors the `INSERT` placeholders 1:1.
 */
export const CATALOG_ITEM_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'kind',
  'name',
  'category_id',
  'price_cents',
  'price_visibility',
  'active',
  'archived_at',
  'duration_minutes',
  'sku',
  'stock',
  'gtin14',
  'reconciliation_pending',
  'reconciliation_last_attempt',
  'commission',
  'unit_ids',
  'unit_overrides',
  'required_resources',
  'public_visible',
  'created_at',
  'updated_at',
] as const

/**
 * Map a decoded `CatalogItem` (+ its projection version) onto the ordered
 * `catalog_items` column VALUES — the inverse of `rowToDoc`, shared by the
 * runtime projector and the E2E seed so the two never diverge. Order matches
 * `CATALOG_ITEM_COLUMNS` exactly. JSONB columns: arrays are `JSON.stringify`'d,
 * objects passed raw (node-pg encodes both identically for `jsonb`).
 */
export function catalogItemColumnValues(item: CatalogItem, lastEventVersion: number): unknown[] {
  const isProduct = isCatalogProduct(item)
  return [
    item.orgId,
    item.id,
    lastEventVersion,
    item.kind,
    item.name,
    item.categoryId,
    item.priceCents,
    item.priceVisibility,
    item.active,
    item.archivedAt,
    isProduct ? null : item.durationMinutes,
    isProduct ? item.sku : null,
    isProduct ? item.stock : null,
    isProduct ? item.gtin14 : null,
    isProduct ? (item.reconciliationPending ?? null) : null,
    isProduct ? (item.reconciliationLastAttempt ?? null) : null,
    item.commission,
    JSON.stringify(item.unitIds),
    item.unitOverrides,
    isProduct ? null : JSON.stringify(item.requiredResources),
    item.publicVisible,
    item.createdAt,
    item.updatedAt,
  ]
}

// INSERT … ON CONFLICT, generated from the single column list so the placeholders
// and the upsert SET clause can never drift from `CATALOG_ITEM_COLUMNS`.
const PLACEHOLDERS = CATALOG_ITEM_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = CATALOG_ITEM_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO catalog_items (${CATALOG_ITEM_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

// ── Derived join table (brief 0068 D3): catalog-item ↔ unit ───────────────────
// The N:N `unitIds` array stays in the reduced state (reducer untouched); the
// projector mirrors it into relational rows in the SAME tx (the `org-projector`
// public-directory pattern). Delete-then-insert keeps replay/edit idempotent — a
// shrunk array leaves no orphan rows. The SQL + value-builder are exported so any
// seed writing `catalog_items` directly stays in lockstep and never drifts.
export const CATALOG_ITEM_UNITS_DELETE =
  'DELETE FROM catalog_item_units WHERE org_id = $1 AND catalog_item_id = $2'
export const CATALOG_ITEM_UNITS_INSERT =
  'INSERT INTO catalog_item_units (org_id, catalog_item_id, unit_id) VALUES ($1, $2, $3)'

export function catalogItemUnitRows(item: CatalogItem): unknown[][] {
  return item.unitIds.map((unitId) => [item.orgId, item.id, unitId])
}

// The reducer's `_version` is carried on the projected state (off the union's
// declared fields), read without asserting shape — mirrors the event store's own
// `projectionVersion`.
function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const item = decodeCatalogItem(state)
  await client.query(UPSERT, catalogItemColumnValues(item, stateVersion(state)))
  // Mirror the N:N `unitIds` array into the join table (same tx). Delete-then-
  // insert so a shrunk array leaves no orphans and replay is idempotent.
  await client.query(CATALOG_ITEM_UNITS_DELETE, [item.orgId, item.id])
  for (const row of catalogItemUnitRows(item)) {
    await client.query(CATALOG_ITEM_UNITS_INSERT, row)
  }
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type CatalogItemRow = {
  org_id: string
  id: string
  last_event_version: string | number
  kind: 'service' | 'product'
  name: string
  category_id: string | null
  price_cents: string | number
  price_visibility: string
  active: boolean
  archived_at: string | null
  duration_minutes: string | number | null
  sku: string | null
  stock: string | number | null
  gtin14: string | null
  reconciliation_pending: boolean | null
  reconciliation_last_attempt: string | null
  commission: unknown
  unit_ids: unknown
  unit_overrides: unknown
  required_resources: unknown
  public_visible: boolean
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`): the kind-discriminated fields are restored per kind, and `_version`
// is re-attached so the event store versions/replays correctly. `bigint` columns
// come back as strings from `pg` — coerced to number to match the domain shape.
export function rowToDoc(row: CatalogItemRow): FirestoreDoc {
  const base = {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    name: row.name,
    categoryId: row.category_id,
    priceCents: Number(row.price_cents),
    commission: row.commission,
    unitIds: row.unit_ids,
    unitOverrides: row.unit_overrides,
    publicVisible: row.public_visible,
    priceVisibility: row.price_visibility,
    active: row.active,
    archivedAt: row.archived_at == null ? null : new Date(row.archived_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
  if (row.kind === 'product') {
    return {
      ...base,
      sku: row.sku,
      stock: row.stock === null ? null : Number(row.stock),
      gtin14: row.gtin14,
      // Reconciliation markers are optional on the union — re-attach only when
      // present so an item without them round-trips to the same shape.
      ...(row.reconciliation_pending === null
        ? {}
        : { reconciliationPending: row.reconciliation_pending }),
      ...(row.reconciliation_last_attempt === null
        ? {}
        : {
            // timestamptz (brief 0068 D1) — normalize Postgres format to ISO.
            reconciliationLastAttempt: new Date(row.reconciliation_last_attempt).toISOString(),
          }),
    }
  }
  return {
    ...base,
    durationMinutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
    requiredResources: row.required_resources,
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<CatalogItemRow>(
    'SELECT * FROM catalog_items WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

// Locked read for the price/availability guard (brief 0033 AC-08): `FOR UPDATE`
// holds the catalog-item row until the guarded append's tx ends, so a concurrent
// reprice/discontinuation can't let two appends snapshot a stale price.
async function readForUpdate(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<CatalogItemRow>(
    'SELECT * FROM catalog_items WHERE org_id = $1 AND id = $2 FOR UPDATE',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  // Drop the join rows explicitly (the parent FK is ON DELETE cascade, so this is
  // defensive + mirrors `member-operation-projector`'s join cleanup). The ref carries
  // the org + id directly.
  await client.query(CATALOG_ITEM_UNITS_DELETE, [ref.orgId, ref.id])
  await client.query('DELETE FROM catalog_items WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

// Org-scoped collection scan (a {@link CollectionRef} for `catalog_item`): the
// reconcile cron reads the pending markers (`where reconciliationPending == true`)
// to reprocess.
async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const tail = buildCollectionQueryTail(constraints, CATALOG_ITEM_COLUMNS, 2, true)
  const res = await client.query<CatalogItemRow>(
    `SELECT * FROM catalog_items WHERE org_id = $1${tail.sql}`,
    [ref.orgId, ...tail.params],
  )
  return res.rows.map(rowToDoc)
}

export const catalogItemProjector: TypedProjector = {
  read,
  readForUpdate,
  upsert,
  delete: remove,
  list,
}

/**
 * `aggregate_type` for catalog items = the typed `AggregateType` literal
 * (`config.type`, singular `catalog_item`) — D6 (ADR 0013). The Postgres Layer
 * routes by the ref's `type`, so registration and routing agree on this literal.
 */
export const CATALOG_ITEM_AGGREGATE_TYPE = CatalogItemConfig.type

// Register on module load. The Postgres Layer imports this module so the
// projector is present before the first projection write.
registerTypedProjector(CATALOG_ITEM_AGGREGATE_TYPE, catalogItemProjector)
