'use server'

import { type SubscriptionPlan } from '@/domain'
import { SubscriptionPlanConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { findDanglingCoverageRef, parsePlanForm } from '@/features/plans/core/plan-form'
import { listCatalogItemIds } from '@/shared/db/effect/catalog-item-read'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { listCategoriesForOrg } from '@/shared/org/category-read'
import { canDeletePlan } from '@/shared/org/delete-guard'
import { requireRecurringManagerCtx, requireRecurringOwnerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type PlanMutationResult = { ok: true } | { ok: false; error: string }

async function validateCoverageRefs(
  orgId: string,
  includedItemIds: string[],
  includedCategoryIds: string[],
): Promise<string | null> {
  if (includedItemIds.length === 0 && includedCategoryIds.length === 0) return null
  const [itemIds, categories] = await Promise.all([
    listCatalogItemIds(orgId),
    listCategoriesForOrg(orgId),
  ])
  const existingItemIds = new Set(itemIds)
  const existingCategoryIds = new Set(categories.map((c) => c.id))
  return findDanglingCoverageRef(
    includedItemIds,
    includedCategoryIds,
    existingItemIds,
    existingCategoryIds,
  )
}

export async function createPlan(formData: FormData): Promise<PlanMutationResult> {
  const r = await requireRecurringManagerCtx()
  if (!r.ok) return r
  const parsed = parsePlanForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const coverageError = await validateCoverageRefs(
    r.ctx.membership.orgId,
    parsed.includedItemIds,
    parsed.includedCategoryIds,
  )
  if (coverageError) return { ok: false, error: coverageError }

  const id = newId()
  const now = new Date().toISOString()
  const { unitAllowlist, allowedTimeScope, bookingLimits, ...rest } = parsed
  const plan: SubscriptionPlan = {
    id,
    orgId: r.ctx.membership.orgId,
    ...rest,
    ...(unitAllowlist ? { unitAllowlist } : {}),
    ...(allowedTimeScope ? { allowedTimeScope } : {}),
    ...(bookingLimits ? { bookingLimits } : {}),
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const created = await emitEvent(
    SubscriptionPlanConfig,
    aggregateRef(SubscriptionPlanConfig, r.ctx.membership.orgId, id),
    { _tag: 'subscription_plan.created', actorId: r.ctx.session.uid, payload: { data: plan } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/plans')
  redirect('/plans')
}

export async function updatePlan(planId: string, formData: FormData): Promise<PlanMutationResult> {
  const r = await requireRecurringManagerCtx()
  if (!r.ok) return r
  const parsed = parsePlanForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const coverageError = await validateCoverageRefs(
    r.ctx.membership.orgId,
    parsed.includedItemIds,
    parsed.includedCategoryIds,
  )
  if (coverageError) return { ok: false, error: coverageError }

  const { unitAllowlist, allowedTimeScope, bookingLimits, ...rest } = parsed
  const updated = await emitEvent(
    SubscriptionPlanConfig,
    aggregateRef(SubscriptionPlanConfig, r.ctx.membership.orgId, planId),
    {
      _tag: 'subscription_plan.updated',
      actorId: r.ctx.session.uid,
      payload: {
        changes: {
          ...rest,
          unitAllowlist: unitAllowlist ?? null,
          allowedTimeScope: allowedTimeScope ?? null,
          bookingLimits: bookingLimits ?? null,
        },
      },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/plans')
  redirect('/plans')
}

export async function deletePlan(planId: string): Promise<PlanMutationResult> {
  const r = await requireRecurringOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  if (!(await canDeletePlan(orgId, planId))) {
    return archivePlan(planId)
  }

  const deleted = await emitEvent(
    SubscriptionPlanConfig,
    aggregateRef(SubscriptionPlanConfig, orgId, planId),
    { _tag: 'subscription_plan.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await deleteOrgProjectionDoc(aggregateRef(SubscriptionPlanConfig, orgId, planId))
  revalidatePath('/plans')
  return { ok: true }
}

export async function archivePlan(planId: string, archived = true): Promise<PlanMutationResult> {
  const r = await requireRecurringOwnerCtx()
  if (!r.ok) return r
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    SubscriptionPlanConfig,
    aggregateRef(SubscriptionPlanConfig, r.ctx.membership.orgId, planId),
    { _tag: 'subscription_plan.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/plans')
  return { ok: true }
}
