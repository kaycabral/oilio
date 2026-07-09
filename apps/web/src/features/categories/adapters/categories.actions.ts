'use server'

import { type Category } from '@/domain'
import { CategoryConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { parseCategoryForm } from '@/features/categories/core/category-form'
import {
  countActiveCatalogItemsInCategory,
  countCatalogItemsInCategory,
} from '@/shared/db/effect/catalog-item-read'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { anyPlanIncludesCategory } from '@/shared/org/subscription-plan-read'
import { revalidatePath } from 'next/cache'

export type CategoryMutationResult = { ok: true } | { ok: false; error: string }

export async function createCategory(formData: FormData): Promise<CategoryMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  const parsed = parseCategoryForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const id = newId()
  const now = new Date().toISOString()
  const category: Category = {
    id,
    orgId,
    ...parsed,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const created = await emitEvent(CategoryConfig, aggregateRef(CategoryConfig, orgId, id), {
    _tag: 'category.created',
    actorId: r.ctx.session.uid,
    payload: { data: category },
  })
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/categories')
  return { ok: true }
}

export async function updateCategory(
  categoryId: string,
  formData: FormData,
): Promise<CategoryMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  const parsed = parseCategoryForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const updated = await emitEvent(CategoryConfig, aggregateRef(CategoryConfig, orgId, categoryId), {
    _tag: 'category.updated',
    actorId: r.ctx.session.uid,
    payload: { changes: { ...parsed } },
  })
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/categories')
  return { ok: true }
}

async function categoryReferenceCount(orgId: string, categoryId: string): Promise<number> {
  const [itemCount, planReferenced] = await Promise.all([
    countCatalogItemsInCategory(orgId, categoryId),
    anyPlanIncludesCategory(orgId, categoryId),
  ])
  return itemCount + (planReferenced ? 1 : 0)
}

export async function getCategoryDeletionImpactAction(
  categoryId: string,
): Promise<{ itemCount: number } | { error: string }> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { error: r.error }
  const itemCount = await countActiveCatalogItemsInCategory(r.ctx.membership.orgId, categoryId)
  return { itemCount }
}

export async function deleteCategory(categoryId: string): Promise<CategoryMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const refs = await categoryReferenceCount(orgId, categoryId)
  if (refs > 0) {
    return archiveCategory(categoryId)
  }

  const deleted = await emitEvent(CategoryConfig, aggregateRef(CategoryConfig, orgId, categoryId), {
    _tag: 'category.deleted',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await deleteOrgProjectionDoc(aggregateRef(CategoryConfig, orgId, categoryId))
  revalidatePath('/categories')
  revalidatePath('/catalog')
  return { ok: true }
}

export async function archiveCategory(
  categoryId: string,
  archived = true,
): Promise<CategoryMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    CategoryConfig,
    aggregateRef(CategoryConfig, r.ctx.membership.orgId, categoryId),
    { _tag: 'category.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/categories')
  revalidatePath('/catalog')
  return { ok: true }
}
