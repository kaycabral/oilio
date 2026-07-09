import { SubscriptionPlan } from '@/domain'
import {
  type SubscriptionPlanRow,
  rowToDoc,
} from '@/shared/db/pg/effect/subscription-plan-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeSubscriptionPlan = Schema.decodeUnknownSync(SubscriptionPlan)

export async function listSubscriptionPlansForOrg(orgId: string): Promise<SubscriptionPlan[]> {
  const rows = await readUnderRls<SubscriptionPlanRow>(orgId, (client) =>
    client
      .query<SubscriptionPlanRow>(
        'SELECT * FROM subscription_plans WHERE org_id = $1 ORDER BY name',
        [orgId],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeSubscriptionPlan(rowToDoc(r)))
}

export async function getSubscriptionPlanById(
  orgId: string,
  planId: string,
): Promise<SubscriptionPlan | null> {
  const rows = await readUnderRls<SubscriptionPlanRow>(orgId, (client) =>
    client
      .query<SubscriptionPlanRow>(
        'SELECT * FROM subscription_plans WHERE org_id = $1 AND id = $2',
        [orgId, planId],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscriptionPlan(rowToDoc(row)) : null
}

export async function anyPlanIncludesCategory(orgId: string, categoryId: string): Promise<boolean> {
  const rows = await readUnderRls<{ exists: boolean }>(orgId, (client) =>
    client
      .query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM plan_included_categories
           WHERE org_id = $1 AND category_id = $2
         ) AS exists`,
        [orgId, categoryId],
      )
      .then((res) => res.rows),
  )
  return rows[0]?.exists ?? false
}
