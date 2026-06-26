import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { Goal } from '@/domain/types/goal'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `goal` context (brief 0060, Grupo C) — plugged into the
 * per-context typed-projection registry without reopening the `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `Goal` schema and maps
 * the flat scalars (type/period/target_cents + unit scope) onto columns the DB
 * constrains. No unions, no PII. The DB enforces the invariants (type enum,
 * positive target) — a violation rolls back event + projection together.
 *
 * D6 (ADR 0013): the typed identity is an {@link AggregateRef} (org_id, id), not a
 * path string; the row is keyed by the composite PK `(org_id, id)` and the
 * projection version lives in `last_event_version`.
 */

const decodeGoal = Schema.decodeUnknownSync(Goal)

/** The ordered `goals` column list — single source of truth for the runtime
 * upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1. */
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

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const goal = decodeGoal(state)
  await client.query(UPSERT, goalColumnValues(goal, ref, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
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

export function rowToDoc(row: GoalRow): FirestoreDoc {
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

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
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
