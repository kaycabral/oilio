import type { FirestoreDoc } from '@/domain/effect'
import { AgendaBlock } from '@/domain/types/agenda-block'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `agenda-block` context (brief 0060, Grupo C) — plugged
 * into the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `AgendaBlock` union
 * (recurring | one_off). It lifts the `kind` discriminant + scope ids (org/unit/
 * professional) onto columns the DB constrains and rides the full variant body
 * (reason/weekday/open/close/startAt/endAt) in the `block` JSONB so the read
 * round-trips to the exact union. The DB enforces the invariants — a violation
 * rolls back event + projection together. No PII.
 */

const decodeAgendaBlock = Schema.decodeUnknownSync(AgendaBlock)

/** The ordered `agenda_blocks` column list — single source of truth for the
 * runtime upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1. */
export const AGENDA_BLOCK_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'unit_id',
  'version',
  'kind',
  'professional_id',
  'block',
  'created_at',
  'updated_at',
] as const

export function agendaBlockColumnValues(
  block: AgendaBlock,
  aggregatePath: string,
  version: number,
): unknown[] {
  // The full variant body rides in JSONB (the discriminant + scope ids are also
  // lifted to columns, but the body is authoritative on read).
  const body = {
    reason: block.reason,
    weekday: block.weekday,
    open: block.open,
    close: block.close,
    startAt: block.startAt,
    endAt: block.endAt,
  }
  return [
    aggregatePath,
    block.orgId,
    block.id,
    block.unitId,
    version,
    block.kind,
    block.professionalId,
    body,
    block.createdAt,
    block.updatedAt,
  ]
}

const PLACEHOLDERS = AGENDA_BLOCK_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = AGENDA_BLOCK_COLUMNS.filter((c) => c !== 'aggregate_path')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO agenda_blocks (${AGENDA_BLOCK_COLUMNS.join(', ')})
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
  const block = decodeAgendaBlock(state)
  await client.query(UPSERT, agendaBlockColumnValues(block, aggregatePath, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
// `block` JSONB carries the full variant body; `kind`/`professional_id` are also
// columns (DB CHECK + queryability) but the body + discriminant reconstruct the
// exact domain union.
export type AgendaBlockRow = {
  org_id: string
  id: string
  unit_id: string
  version: string | number
  kind: 'recurring' | 'one_off'
  professional_id: string | null
  block: {
    reason: string
    // Day-name weekday (`'monday'`…) for a recurring block, null for one_off —
    // mirrors the domain `RecurringAgendaBlock.weekday` (a `Weekday` literal,
    // NOT a number).
    weekday: string | null
    open: string | null
    close: string | null
    startAt: string | null
    endAt: string | null
  }
  created_at: string
  updated_at: string
}

export function rowToDoc(row: AgendaBlockRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    professionalId: row.professional_id,
    kind: row.kind,
    reason: row.block.reason,
    weekday: row.block.weekday,
    open: row.block.open,
    close: row.block.close,
    startAt: row.block.startAt,
    endAt: row.block.endAt,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<AgendaBlockRow>(
    'SELECT * FROM agenda_blocks WHERE aggregate_path = $1',
    [aggregatePath],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM agenda_blocks WHERE aggregate_path = $1', [aggregatePath])
}

export const agendaBlockProjector: TypedProjector = { read, upsert, delete: remove }

export const AGENDA_BLOCK_AGGREGATE_TYPE = 'agenda_blocks'

registerTypedProjector(AGENDA_BLOCK_AGGREGATE_TYPE, agendaBlockProjector)
