import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { Category } from '@/domain/types/category'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeCategory = Schema.decodeUnknownSync(Category)

export const CATEGORY_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'name',
  'icon',
  'color',
  'active',
  'archived_at',
  'created_at',
  'updated_at',
] as const

export function categoryColumnValues(category: Category, version: number): unknown[] {
  return [
    category.orgId,
    category.id,
    version,
    category.name,
    category.icon,
    category.color,
    category.active,
    category.archivedAt,
    category.createdAt,
    category.updatedAt,
  ]
}

const PLACEHOLDERS = CATEGORY_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = CATEGORY_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO categories (${CATEGORY_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const category = decodeCategory(state)
  await client.query(UPSERT, categoryColumnValues(category, stateVersion(state)))
}

export type CategoryRow = {
  org_id: string
  id: string
  last_event_version: string | number
  name: string
  icon: string | null
  color: string | null
  active: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export function rowToDoc(row: CategoryRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    active: row.active,
    archivedAt: row.archived_at == null ? null : new Date(row.archived_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<CategoryRow>(
    'SELECT * FROM categories WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM categories WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const categoryProjector: TypedProjector = { read, upsert, delete: remove }

export const CATEGORY_AGGREGATE_TYPE = 'category'

registerTypedProjector(CATEGORY_AGGREGATE_TYPE, categoryProjector)
