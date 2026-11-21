import { CatalogItemConfig } from '@/domain/aggregates/catalog-item/config'
import type { AggregateRef, CollectionRef, QueryConstraint, StoredDoc } from '@/domain/effect'
import { CatalogItem, isCatalogProduct } from '@/domain/types/catalog-item'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeCatalogItem = Schema.decodeUnknownSync(CatalogItem)

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

const PLACEHOLDERS = CATALOG_ITEM_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = CATALOG_ITEM_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO catalog_items (${CATALOG_ITEM_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

export const CATALOG_ITEM_UNITS_DELETE =
  'DELETE FROM catalog_item_units WHERE org_id = $1 AND catalog_item_id = $2'
export const CATALOG_ITEM_UNITS_INSERT =
  'INSERT INTO catalog_item_units (org_id, catalog_item_id, unit_id) VALUES ($1, $2, $3)'

export function catalogItemUnitRows(item: CatalogItem): unknown[][] {
  return item.unitIds.map((unitId) => [item.orgId, item.id, unitId])
}

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: StoredDoc): Promise<void> {
  const item = decodeCatalogItem(state)
  await client.query(UPSERT, catalogItemColumnValues(item, stateVersion(state)))
  await client.query(CATALOG_ITEM_UNITS_DELETE, [item.orgId, item.id])
  for (const row of catalogItemUnitRows(item)) {
    await client.query(CATALOG_ITEM_UNITS_INSERT, row)
  }
}

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

export function rowToDoc(row: CatalogItemRow): StoredDoc {
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
      ...(row.reconciliation_pending === null
        ? {}
        : { reconciliationPending: row.reconciliation_pending }),
      ...(row.reconciliation_last_attempt === null
        ? {}
        : {
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

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<CatalogItemRow>(
    'SELECT * FROM catalog_items WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function readForUpdate(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<CatalogItemRow>(
    'SELECT * FROM catalog_items WHERE org_id = $1 AND id = $2 FOR UPDATE',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query(CATALOG_ITEM_UNITS_DELETE, [ref.orgId, ref.id])
  await client.query('DELETE FROM catalog_items WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<StoredDoc[]> {
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

export const CATALOG_ITEM_AGGREGATE_TYPE = CatalogItemConfig.type

registerTypedProjector(CATALOG_ITEM_AGGREGATE_TYPE, catalogItemProjector)
