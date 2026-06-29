import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { AgendaBlock } from '@/domain/types/agenda-block'
import { buildMemberIdUpsert } from '@/shared/db/pg/effect/member-id-upsert'
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
 * memberOperation) onto columns the DB constrains and rides the full variant body
 * (reason/weekday/open/close/startAt/endAt) in the `block` JSONB so the read
 * round-trips to the exact union. The DB enforces the invariants — a violation
 * rolls back event + projection together. No PII.
 */

const decodeAgendaBlock = Schema.decodeUnknownSync(AgendaBlock)

/** The ordered `agenda_blocks` column list — single source of truth for the
 * runtime upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1. */
export const AGENDA_BLOCK_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'kind',
  'member_operation_id',
  'block',
  'created_at',
  'updated_at',
] as const

export function agendaBlockColumnValues(block: AgendaBlock, version: number): unknown[] {
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
    block.orgId,
    block.id,
    block.unitId,
    version,
    block.kind,
    block.memberOperationId,
    body,
    block.createdAt,
    block.updatedAt,
  ]
}

// `member_id` derived from the operational profile (brief 0076 AC-04). A
// whole-unit block has a NULL `member_operation_id`, so the subquery yields NULL
// and `member_id` is NULL in lock-step (both FKs are SET NULL). When a member is
// scoped, the FK guarantees the profile row exists in this tx, so the subquery
// resolves to its membership. Built by the shared `buildMemberIdUpsert` (same rule
// for appointments).
const UPSERT = buildMemberIdUpsert('agenda_blocks', AGENDA_BLOCK_COLUMNS)

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const block = decodeAgendaBlock(state)
  await client.query(UPSERT, agendaBlockColumnValues(block, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
// `block` JSONB carries the full variant body; `kind`/`member_operation_id` are also
// columns (DB CHECK + queryability) but the body + discriminant reconstruct the
// exact domain union.
export type AgendaBlockRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  kind: 'recurring' | 'one_off'
  member_operation_id: string | null
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
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    memberOperationId: row.member_operation_id,
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

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<AgendaBlockRow>(
    'SELECT * FROM agenda_blocks WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM agenda_blocks WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const agendaBlockProjector: TypedProjector = { read, upsert, delete: remove }

export const AGENDA_BLOCK_AGGREGATE_TYPE = 'agenda_block'

registerTypedProjector(AGENDA_BLOCK_AGGREGATE_TYPE, agendaBlockProjector)
