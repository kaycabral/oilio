import { Goal, goalDocId, type GoalType } from '@/domain'
import { rowToDoc, type GoalRow } from '@/shared/db/pg/effect/goal-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeGoal = Schema.decodeUnknownSync(Goal)

// Direct lookup by deterministic id — a goal is unique per (type, unit, period),
// so no extra query/index is needed. Reads the typed `goals` table under RLS
// (unit-scoped GUC).
export async function getGoalForPeriod(
  orgId: string,
  type: GoalType,
  unitId: string,
  period: string,
): Promise<Goal | null> {
  const id = goalDocId(type, unitId, period)
  const rows = await readUnderRls<GoalRow>(
    orgId,
    (client) =>
      client
        .query<GoalRow>('SELECT * FROM goals WHERE aggregate_path = $1', [
          `orgs/${orgId}/goals/${id}`,
        ])
        .then((res) => res.rows),
    unitId,
  )
  const row = rows[0]
  return row ? decodeGoal(rowToDoc(row)) : null
}
