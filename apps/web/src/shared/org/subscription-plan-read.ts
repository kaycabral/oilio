// Server-side reads for the `subscription-plan` context (brief 0060, Grupo B).
// Plans carry NO PII, so there is no sidecar merge — the read just decodes the
// typed projection from the `subscription_plans` table under RLS.

import { SubscriptionPlan } from '@/domain'
import {
  type SubscriptionPlanRow,
  rowToDoc,
} from '@/shared/db/pg/effect/subscription-plan-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeSubscriptionPlan = Schema.decodeUnknownSync(SubscriptionPlan)

// List all subscription plans for a org, ordered by name, from the typed table
// under RLS.
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
      .query<SubscriptionPlanRow>('SELECT * FROM subscription_plans WHERE aggregate_path = $1', [
        `orgs/${orgId}/subscription_plans/${planId}`,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscriptionPlan(rowToDoc(row)) : null
}

// Whether ANY of the org's plans includes `categoryId` in its coverage — the
// category delete-vs-archive FK guard (`categoryReferenceCount`). Served by the
// `plan_included_categories` join table (brief 0068 D3) via its
// (org_id, category_id) index, replacing the JSONB `included_category_ids @>`
// containment scan. No full decode — existence only.
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
