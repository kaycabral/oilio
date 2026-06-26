'use server'

import { type SubscriptionPlan } from '@/domain'
import { SubscriptionPlanConfig } from '@/domain/aggregates'
import { findDanglingCoverageRef, parsePlanForm } from '@/features/plans/core/plan-form'
import { listCatalogItemIds } from '@/shared/db/effect/catalog-item-read'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { listCategoriesForOrg } from '@/shared/org/category-read'
import { canDeletePlan } from '@/shared/org/delete-guard'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type PlanMutationResult = { ok: true } | { ok: false; error: string }

// Integrity validation for plan coverage (brief 0024, AC-03 — defense in
// depth, never trust the client). Every `includedItemIds` / `includedCategoryIds`
// must reference a doc that actually exists under the org. Returns an error
// string on the first dangling reference, or `null` when the coverage is clean.
// Runs before the domain event is emitted, so a malformed coverage never
// reaches the event store.
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
  const r = await requireManagerCtx()
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
  // Build doc without optional scope fields when undefined so Firestore
  // omits them — keeps semantic "no restriction" clean and round-trips
  // correctly through optional plan fields.
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
    `orgs/${r.ctx.membership.orgId}/subscription_plans/${id}`,
    { _tag: 'subscription_plan.created', actorId: r.ctx.session.uid, payload: { data: plan } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/plans')
  redirect('/plans')
}

export async function updatePlan(planId: string, formData: FormData): Promise<PlanMutationResult> {
  const r = await requireManagerCtx()
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
  // Limpar restrição (undefined) vira `null` explícito no evento: a projeção
  // (setDoc merge) não apaga chave, e `null` é falsy = "sem restrição" pros
  // leitores (mesma semântica do antigo `FieldValue.delete()`).
  const updated = await emitEvent(
    SubscriptionPlanConfig,
    `orgs/${r.ctx.membership.orgId}/subscription_plans/${planId}`,
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
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  // One-verb "Excluir" (brief 0033, AC-03 — #1070). The UI exposes a single
  // destructive verb; this action decides hard vs soft below. Active-reference
  // guard (AC-01/AC-02): a *non-terminal* subscription is a live reference — a
  // cancelled subscription keeps the plan resolvable via its own frozen
  // snapshot and does not block. When there IS an active reference we DON'T
  // error; we soft-delete (archive) so the plan drops from the active offer
  // while existing subscribers keep their frozen snapshot (os assinantes atuais
  // continuam). With no active reference we hard-delete.
  if (!(await canDeletePlan(orgId, planId))) {
    return archivePlan(planId)
  }

  const deleted = await emitEvent(
    SubscriptionPlanConfig,
    `orgs/${orgId}/subscription_plans/${planId}`,
    { _tag: 'subscription_plan.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await deleteOrgProjectionDoc(orgId, 'subscription_plans', planId)
  revalidatePath('/plans')
  return { ok: true }
}

// Archive a plan (uniform delete policy, brief 0027 AC-06). Sets `archivedAt`
// via the event-sourced `subscription_plan.archived` event — the plan stays
// resolvable for historical subscriptions but drops out of active lists +
// the new-subscription picker. `archived=false` restores it.
export async function archivePlan(planId: string, archived = true): Promise<PlanMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    SubscriptionPlanConfig,
    `orgs/${r.ctx.membership.orgId}/subscription_plans/${planId}`,
    { _tag: 'subscription_plan.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/plans')
  return { ok: true }
}
