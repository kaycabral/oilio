'use server'

import { type Category } from '@/domain'
import { CategoryConfig } from '@/domain/aggregates'
import { parseCategoryForm } from '@/features/categories/core/category-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { Schema } from 'effect'
import { revalidatePath } from 'next/cache'

// Only `archivedAt` is read to count active (non-archived) catalog items.
const CatalogItemArchival = Schema.Struct({
  archivedAt: Schema.optional(Schema.NullOr(Schema.String)),
})

// Category CRUD (brief 0023, AC-03). Category is a first-class entity at
// `orgs/{orgId}/categories/{id}`; `CatalogItem.categoryId` and
// `SubscriptionPlan.includedCategoryIds` are FKs into it (AC-04). Event-sourced
// like every other aggregate — mutations go through `emitEvent`, never a direct
// set/update. Delete-in-use is blocked (AC-05).

export type CategoryMutationResult = { ok: true } | { ok: false; error: string }

export async function createCategory(formData: FormData): Promise<CategoryMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  const parsed = parseCategoryForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const ref = db.collection('orgs').doc(orgId).collection('categories').doc()
  const now = new Date().toISOString()
  const category: Category = {
    id: ref.id,
    orgId,
    ...parsed,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const created = await emitEvent(CategoryConfig, `orgs/${orgId}/categories/${ref.id}`, {
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

  const updated = await emitEvent(CategoryConfig, `orgs/${orgId}/categories/${categoryId}`, {
    _tag: 'category.updated',
    actorId: r.ctx.session.uid,
    payload: { changes: { ...parsed } },
  })
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/categories')
  return { ok: true }
}

// AC-05: never orphan an FK. A category referenced by any catalog item or
// subscription plan can't be deleted — we block with a clear error (chosen over
// reassign: there's no obviously-correct target to reassign to, and silently
// moving references could mis-label a customer's plan/item). The owner must
// first repoint or remove the referencing docs.
async function categoryReferenceCount(orgId: string, categoryId: string): Promise<number> {
  const db = getAdminFirestore()
  const org = db.collection('orgs').doc(orgId)
  const [items, plans] = await Promise.all([
    org.collection('catalog_items').where('categoryId', '==', categoryId).limit(1).get(),
    org
      .collection('subscription_plans')
      .where('includedCategoryIds', 'array-contains', categoryId)
      .limit(1)
      .get(),
  ])
  return items.size + plans.size
}

// Powers the delete-confirm dialog's warning (brief 0033, AC-10/AC-11): deleting
// a category re-buckets its active items to "Sem categoria" — informed, never a
// surprise. Counts only ACTIVE items (archived ones aren't shown anywhere the
// label matters). Owner-gated like the delete. No blocking — categories carry no
// impact to orders (OrderItem snapshots, no category FK), reports (no category
// grouping) or subscription coverage (frozen snapshot + items keep `categoryId`).
export async function getCategoryDeletionImpactAction(
  categoryId: string,
): Promise<{ itemCount: number } | { error: string }> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { error: r.error }
  const items = await getAdminFirestore()
    .collection('orgs')
    .doc(r.ctx.membership.orgId)
    .collection('catalog_items')
    .withConverter(fsConverter(CatalogItemArchival))
    .where('categoryId', '==', categoryId)
    .get()
  const itemCount = items.docs.filter((d) => !d.data().archivedAt).length
  return { itemCount }
}

export async function deleteCategory(categoryId: string): Promise<CategoryMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  // One-verb "Excluir" (brief 0033, AC-03 — #1070): single destructive verb,
  // hard vs soft decided here. A category referenced by any catalog item or
  // subscription plan is in use; deleting it would orphan that label, so we
  // soft-delete (archive) — it drops from the pickers + inline manager while
  // items/plans keep the label resolvable. With no reference we hard-delete.
  const refs = await categoryReferenceCount(orgId, categoryId)
  if (refs > 0) {
    return archiveCategory(categoryId)
  }

  const deleted = await emitEvent(CategoryConfig, `orgs/${orgId}/categories/${categoryId}`, {
    _tag: 'category.deleted',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('categories')
    .doc(categoryId)
    .delete()
  revalidatePath('/categories')
  revalidatePath('/catalog')
  return { ok: true }
}

// Archive a category (uniform delete policy, brief 0027 AC-06). Where
// delete-in-use is blocked, archive lets the owner retire an in-use category:
// it stays resolvable for historical items/plans but drops out of the active
// pickers + the inline manager. Sets `archivedAt` via `category.archived`.
// `archived=false` restores it.
export async function archiveCategory(
  categoryId: string,
  archived = true,
): Promise<CategoryMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    CategoryConfig,
    `orgs/${r.ctx.membership.orgId}/categories/${categoryId}`,
    { _tag: 'category.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/categories')
  revalidatePath('/catalog')
  return { ok: true }
}
