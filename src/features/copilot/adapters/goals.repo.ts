import { Goal, goalDocId, type GoalType } from '@/domain'
import { rowToDoc, type GoalRow } from '@/shared/db/pg/effect/goal-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeGoal = Schema.decodeUnknownSync(Goal)

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
        .query<GoalRow>('SELECT * FROM goals WHERE org_id = $1 AND id = $2', [orgId, id])
        .then((res) => res.rows),
    unitId,
  )
  const row = rows[0]
  return row ? decodeGoal(rowToDoc(row)) : null
}
