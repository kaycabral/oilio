import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { Category } from '@/domain/types/category'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `category` context (brief 0060, Grupo B) — plugged into
 * the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `Category` schema (no
 * PII — the full shape is stored). It maps the scalars (name/active) onto columns
 * the DB constrains plus the nullable visual cues; there are no composite fields.
 * The DB enforces the invariants — a violation rolls back event + projection
 * together.
 */

const decodeCategory = Schema.decodeUnknownSync(Category)

/**
 * The ordered `categories` column list — single source of truth for the runtime
 * upsert and the E2E seed (so the two writers can never drift). Mirrors the
 * `INSERT` placeholders 1:1. Keyed by the composite `(org_id, id)` PK (D6, ADR
 * 0013); `last_event_version` is the projection's monotonic version column.
 */
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

// Row shape the typed table stores; mapped back to the reducer's doc on read.
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

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` is re-attached so the event store versions/replays
// correctly.
export function rowToDoc(row: CategoryRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    active: row.active,
    // `created_at`/`updated_at`/`archived_at` are `timestamptz` columns (brief
    // 0068 D1). With `mode:'string'` the pg driver returns the Postgres format
    // (`2026-06-10 14:00:00+00`), NOT ISO 8601 — the domain `Category.*` and the
    // lexicographic range reads expect the ISO instant the writer stored.
    // Normalize back to ISO at this single read boundary (same as appointments).
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
