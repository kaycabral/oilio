import { UnitConfig } from '@/domain/aggregates/unit/config'
import type { AggregateRef, CollectionRef, QueryConstraint, StoredDoc } from '@/domain/effect'
import { StoredUnit } from '@/domain/types/unit'
import { isUnitPubliclyLive } from '@/domain/utils/business-hours'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { buildCollectionQueryTail } from './collection-query'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeUnit = Schema.decodeUnknownSync(StoredUnit)

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

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: StoredDoc): Promise<void> {
  const unit = decodeUnit(state)
  await client.query(UPSERT, unitColumnValues(unit, stateVersion(state)))
}

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

export function rowToDoc(row: UnitRow): StoredDoc {
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

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
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

async function list(
  client: PoolClient,
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<StoredDoc[]> {
  const tail = buildCollectionQueryTail(constraints, UNIT_COLUMNS, 2, true)
  const res = await client.query<UnitRow>(`SELECT * FROM units WHERE org_id = $1${tail.sql}`, [
    ref.orgId,
    ...tail.params,
  ])
  return res.rows.map(rowToDoc)
}

export const unitProjector: TypedProjector = { read, upsert, delete: remove, list }

export const UNIT_AGGREGATE_TYPE = UnitConfig.type

registerTypedProjector(UNIT_AGGREGATE_TYPE, unitProjector)
