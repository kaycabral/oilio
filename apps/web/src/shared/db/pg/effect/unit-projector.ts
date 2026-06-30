import { UnitConfig } from '@/domain/aggregates/unit/config'
import type { AggregateRef, CollectionRef, FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { isUnitPubliclyLive, StoredUnit } from '@/domain/types/unit'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `unit` context (brief 0059, AC-01/AC-05) — the physical
 * establishment, plugged into the per-context typed-projection registry without
 * reopening the `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `StoredUnit` schema —
 * the PII-omitted shape (whatsapp/email live in the deletable `units_pii`
 * sidecar, LGPD contract). It maps the union discriminants onto columns and the
 * variant bodies onto JSONB (mirrors the catalog-item `service | product`
 * pattern):
 *   - `agenda` (fixed | always_open | appointment) → `agenda_mode` column
 *     (CHECK) + `agenda` JSONB body.
 *   - `fiscal` (informal | company) → `fiscal_kind` column (CHECK) + `fiscal`
 *     JSONB body.
 * The DB enforces the discriminant CHECKs + non-empty name/slug/timezone + the FK
 * `org_id → orgs` — a violation rolls back event + projection together.
 */

const decodeUnit = Schema.decodeUnknownSync(StoredUnit)

/**
 * The ordered `units` column list — the single source of truth for the runtime
 * upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1.
 */
export const UNIT_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'name',
  'slug',
  'timezone',
  'archived_at',
  'agenda_mode',
  'fiscal_kind',
  'address',
  'agenda',
  'fiscal',
  'public_visible',
  'created_at',
  'updated_at',
] as const

/**
 * Map a decoded `StoredUnit` (+ projection version) onto the ordered `units`
 * column VALUES — the inverse of `rowToDoc`, shared by the runtime projector and
 * the E2E seed. Order matches `UNIT_COLUMNS` exactly; `org_id`/`id` come straight
 * off the unit. The union discriminants (`agenda.mode`, `fiscal.kind`) are lifted
 * to columns; the full bodies ride in JSONB. `public_visible` mirrors the unit's
 * inferred public availability (`isUnitPubliclyLive`: appointment mode + complete
 * address & hours — no stored publish flag, PRD Identidade v2 / SPIKE) — kept
 * nullable for forward-compat.
 */
export function unitColumnValues(unit: StoredUnit, lastEventVersion: number): unknown[] {
  const publicVisible = isUnitPubliclyLive(unit)
  return [
    unit.orgId,
    unit.id,
    lastEventVersion,
    unit.name,
    unit.slug,
    unit.timezone,
    unit.archivedAt,
    unit.agenda.mode,
    unit.fiscal.kind,
    unit.address,
    unit.agenda,
    unit.fiscal,
    publicVisible,
    unit.createdAt,
    unit.updatedAt,
  ]
}

const PLACEHOLDERS = UNIT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = UNIT_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO units (${UNIT_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const unit = decodeUnit(state)
  await client.query(UPSERT, unitColumnValues(unit, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
// `agenda`/`fiscal` JSONB carry the full variant bodies (discriminants are also
// lifted to `agenda_mode`/`fiscal_kind` columns, but the body is authoritative
// on read — round-trips to the exact domain union).
export type UnitRow = {
  org_id: string
  id: string
  last_event_version: string | number
  name: string
  slug: string
  timezone: string
  archived_at: string | null
  agenda_mode: string
  fiscal_kind: string
  address: unknown
  agenda: unknown
  fiscal: unknown
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). The `agenda`/`fiscal` JSONB bodies are authoritative (they carry the
// discriminant + the variant fields); the discriminant columns exist for the DB
// CHECK + queryability, not for reconstruction. `_version` is re-attached.
export function rowToDoc(row: UnitRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    archivedAt: row.archived_at == null ? null : new Date(row.archived_at).toISOString(),
    agenda: row.agenda,
    fiscal: row.fiscal,
    address: row.address,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<UnitRow>('SELECT * FROM units WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM units WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

// Org-scoped collection scan (a {@link CollectionRef} for `unit`): the domain
// reads the whole unit list (no constraints) to fan a notification out per
// establishment.
async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<FirestoreDoc[]> {
  const tail = buildCollectionQueryTail(constraints, UNIT_COLUMNS, 2, true)
  const res = await client.query<UnitRow>(`SELECT * FROM units WHERE org_id = $1${tail.sql}`, [
    ref.orgId,
    ...tail.params,
  ])
  return res.rows.map(rowToDoc)
}

export const unitProjector: TypedProjector = { read, upsert, delete: remove, list }

/**
 * `aggregate_type` for units = the typed `AggregateType` literal (`config.type`,
 * singular `unit`) — D6 (ADR 0013). The Postgres Layer routes by the ref's
 * `type`, so registration and routing agree on this literal.
 */
export const UNIT_AGGREGATE_TYPE = UnitConfig.type

registerTypedProjector(UNIT_AGGREGATE_TYPE, unitProjector)
