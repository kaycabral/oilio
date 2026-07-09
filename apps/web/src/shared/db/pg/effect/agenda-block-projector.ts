import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { AgendaBlock } from '@/domain/types/agenda-block'
import { buildMemberIdUpsert } from '@/shared/db/pg/effect/member-id-upsert'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeAgendaBlock = Schema.decodeUnknownSync(AgendaBlock)

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

const UPSERT = buildMemberIdUpsert('agenda_blocks', AGENDA_BLOCK_COLUMNS)

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const block = decodeAgendaBlock(state)
  await client.query(UPSERT, agendaBlockColumnValues(block, stateVersion(state)))
}

export type AgendaBlockRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  kind: 'recurring' | 'one_off'
  member_operation_id: string | null
  block: {
    reason: string
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
