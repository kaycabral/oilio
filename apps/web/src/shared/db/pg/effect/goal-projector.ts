import type { AggregateRef, StoredDoc } from '@/domain/effect'
import { Goal } from '@/domain/types/goal'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeGoal = Schema.decodeUnknownSync(Goal)

export const GOAL_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'last_event_version',
  'period',
  'type',
  'target_cents',
  'created_at',
  'updated_at',
] as const

export function goalColumnValues(goal: Goal, ref: AggregateRef, version: number): unknown[] {
  return [
    ref.orgId,
    ref.id,
    goal.unitId,
    version,
    goal.period,
    goal.type,
    goal.targetCents,
    goal.createdAt,
    goal.updatedAt,
  ]
}

const PLACEHOLDERS = GOAL_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = GOAL_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO goals (${GOAL_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: StoredDoc): Promise<void> {
  const goal = decodeGoal(state)
  await client.query(UPSERT, goalColumnValues(goal, ref, stateVersion(state)))
}

export type GoalRow = {
  org_id: string
  id: string
  unit_id: string
  last_event_version: string | number
  period: string
  type: 'profit'
  target_cents: string | number
  created_at: string
  updated_at: string
}

export function rowToDoc(row: GoalRow): StoredDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    period: row.period,
    type: row.type,
    targetCents: Number(row.target_cents),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<GoalRow>('SELECT * FROM goals WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM goals WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const goalProjector: TypedProjector = { read, upsert, delete: remove }

export const GOAL_AGGREGATE_TYPE = 'goal'

registerTypedProjector(GOAL_AGGREGATE_TYPE, goalProjector)
