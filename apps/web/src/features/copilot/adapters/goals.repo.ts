import { Goal, goalDocId, type GoalType } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'

// Direct doc get by deterministic id — a goal is unique per (type, unit,
// period), so no query/index is needed (org-scoped, no collectionGroup).
export async function getGoalForPeriod(
  orgId: string,
  type: GoalType,
  unitId: string,
  period: string,
): Promise<Goal | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('goals')
    .withConverter(fsConverter(Goal))
    .doc(goalDocId(type, unitId, period))
    .get()
  return snap.data() ?? null
}
