'use server'

import {
  CatalogItem,
  type CatalogItemKind,
  type ServicePriceVisibility,
  StoredProfessional,
  isCatalogService,
  normalizeCatalogItemKind,
  normalizeServicePriceVisibility,
} from '@/domain'
import { CatalogItemConfig, ProfessionalConfig } from '@/domain/aggregates'
import {
  parseCommissionFromForm,
  parseUnitOverrides,
} from '@/features/catalog/core/catalog-item-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { canDeleteCatalogItem } from '@/shared/tenant/delete-guard'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/tenant/membership'
import { getProfessionalById } from '@/shared/tenant/professional-read'
import { revalidatePath } from 'next/cache'

// Unified catalog CRUD (brief 0023, AC-02). Mirrors the service/product server
// actions but writes a single `catalog_items` collection discriminated by
// `kind`. Services/products keep their own routes + collections until the
// consumer migration (#1004) and UI convergence (#1005) land — this slice only
// ADDS the unified model.

export type CatalogItemMutationResult = { ok: true } | { ok: false; error: string }

// Distributive Omit: keeps the discriminated union intact (each member keeps
// its kind-specific fields) instead of collapsing to the common keys only.
type StoredFields = 'id' | 'tenantId' | 'archivedAt' | 'createdAt' | 'updatedAt'
type CatalogItemPayload = CatalogItem extends infer T
  ? T extends CatalogItem
    ? Omit<T, StoredFields>
    : never
  : never

async function tenantUnitIds(tenantId: string): Promise<Set<string>> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('units')
    .get()
  return new Set(snap.docs.map((d) => d.id))
}

// AC-04: `categoryId` is a real FK into `tenants/{tenantId}/categories/{id}`.
// Defense in depth — like the unit check above, the server action validates the
// referenced category exists in this tenant before accepting the write so a
// crafted form can't point an item at a nonexistent/foreign category.
async function tenantCategoryExists(tenantId: string, categoryId: string): Promise<boolean> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('categories')
    .doc(categoryId)
    .get()
  return snap.exists
}

async function parseCatalogItemForm(
  tenantId: string,
  formData: FormData,
): Promise<CatalogItemPayload | string> {
  const kind: CatalogItemKind = normalizeCatalogItemKind(formData.get('kind'))

  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const categoryId = formString(formData, 'categoryId').trim() || null
  if (categoryId !== null && !(await tenantCategoryExists(tenantId, categoryId))) {
    return 'Categoria inválida ou inexistente'
  }

  const priceStr = formString(formData, 'priceCents').trim()
  const priceCents = Math.round(Number(priceStr.replace(',', '.')) * 100)
  if (!Number.isFinite(priceCents) || priceCents < 0) return 'Preço inválido'

  const commission = parseCommissionFromForm('commissionKind', 'commissionValue', formData)
  if (typeof commission === 'string') return commission

  const active = formData.get('active') === 'on'
  const publicVisible = formData.get('publicVisible') === 'on'
  const priceVisibility: ServicePriceVisibility = normalizeServicePriceVisibility(
    formData.get('priceVisibility'),
  )

  const unitIds = formData
    .getAll('unitIds')
    .filter((v): v is string => typeof v === 'string')
    .filter((s) => s.length > 0)
  if (unitIds.length === 0) {
    return 'Selecione pelo menos uma unidade onde o item é oferecido.'
  }
  const known = await tenantUnitIds(tenantId)
  const unknown = unitIds.filter((u) => !known.has(u))
  if (unknown.length > 0) {
    return `Unidade(s) desconhecida(s): ${unknown.join(', ')}`
  }
  const uniqueUnitIds = Array.from(new Set(unitIds))

  const overrides = parseUnitOverrides(formData, uniqueUnitIds)
  if (typeof overrides === 'string') return overrides

  const common = {
    name,
    categoryId,
    priceCents,
    commission,
    unitIds: uniqueUnitIds,
    unitOverrides: overrides,
    publicVisible,
    priceVisibility,
    active,
  }

  if (kind === 'service') {
    const duration = Number(formData.get('durationMinutes'))
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) {
      return 'Duração inválida (em minutos, > 0)'
    }
    const requiredResources = formString(formData, 'requiredResources')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return {
      kind: 'service',
      ...common,
      durationMinutes: Math.round(duration),
      requiredResources,
    }
  }

  const sku = formString(formData, 'sku').trim() || null
  const stock = Number(formData.get('stock'))
  if (!Number.isFinite(stock) || stock < 0) return 'Estoque inválido'
  return {
    kind: 'product',
    ...common,
    sku,
    stock: Math.round(stock),
  }
}

export async function createCatalogItem(formData: FormData): Promise<CatalogItemMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const tenantId = r.ctx.membership.tenantId
  const parsed = await parseCatalogItemForm(tenantId, formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const ref = db.collection('tenants').doc(tenantId).collection('catalog_items').doc()
  const now = new Date().toISOString()
  const item = {
    id: ref.id,
    tenantId,
    ...parsed,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  } as CatalogItem
  const created = await emitEvent(
    CatalogItemConfig,
    `tenants/${tenantId}/catalog_items/${ref.id}`,
    { _tag: 'catalog_item.created', actorId: r.ctx.session.uid, payload: { data: item } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/catalog')
  return { ok: true }
}

export async function updateCatalogItem(
  catalogItemId: string,
  formData: FormData,
): Promise<CatalogItemMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const tenantId = r.ctx.membership.tenantId
  const parsed = await parseCatalogItemForm(tenantId, formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const updated = await emitEvent(
    CatalogItemConfig,
    `tenants/${tenantId}/catalog_items/${catalogItemId}`,
    {
      _tag: 'catalog_item.updated',
      actorId: r.ctx.session.uid,
      payload: { changes: { ...parsed } },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/catalog')
  return { ok: true }
}

export async function deleteCatalogItem(catalogItemId: string): Promise<CatalogItemMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const tenantId = r.ctx.membership.tenantId

  // One-verb "Excluir" (brief 0033, AC-03 — #1070): single destructive verb,
  // hard vs soft decided here. Active-reference guard (AC-01/AC-02): a live
  // consumer is an OPEN order with a line item referencing it, or an ACTIVE
  // subscription whose frozen coverage snapshot includes it. Membership in a
  // plan *definition* (`includedItemIds`) is editable config, not an active
  // reference; closed/cancelled orders are historical and snapshotted. With an
  // active reference we soft-delete (archive) — the item drops from the active
  // catalog while open comandas/active subscriptions keep their frozen snapshot.
  // With no active reference we hard-delete.
  if (!(await canDeleteCatalogItem(tenantId, catalogItemId))) {
    return archiveCatalogItem(catalogItemId)
  }

  const deleted = await emitEvent(
    CatalogItemConfig,
    `tenants/${tenantId}/catalog_items/${catalogItemId}`,
    { _tag: 'catalog_item.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('catalog_items')
    .doc(catalogItemId)
    .delete()
  revalidatePath('/catalog')
  return { ok: true }
}

// Archive a catalog item (uniform delete policy, brief 0027 AC-06). Where
// delete-in-coverage is blocked, archive lets the owner retire an in-use item:
// it stays resolvable for historical plans/orders but drops out of the active
// catalog table + item pickers. Sets `archivedAt` via `catalog_item.archived`.
// `archived=false` restores it.
export async function archiveCatalogItem(
  catalogItemId: string,
  archived = true,
): Promise<CatalogItemMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    CatalogItemConfig,
    `tenants/${r.ctx.membership.tenantId}/catalog_items/${catalogItemId}`,
    { _tag: 'catalog_item.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/catalog')
  return { ok: true }
}

// Service item ↔ professional link (brief 0023, #1005). Moved here from the
// now-deleted `/services` route (AC-10) — `/catalog` is the single place to
// manage items, including which professionals execute a service. Reads the
// unified `catalog_items` collection and writes the `serviceIds` membership on
// each affected professional (event-sourced, `professional.updated`).
//
// Cross-edit reached from a service item's catalog editor. Enforces the #876
// invariant (`item.unitIds ∩ Professional.unitIds ≠ ∅`) before flipping each
// pro's `serviceIds` membership. Atomic per-pro: each affected professional
// gets a single document write.
export async function setServiceProfessionals(
  serviceId: string,
  professionalIds: string[],
): Promise<CatalogItemMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const tenantId = r.ctx.membership.tenantId
  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenantId)

  const serviceSnap = await tenantRef
    .collection('catalog_items')
    .withConverter(fsConverter(CatalogItem))
    .doc(serviceId)
    .get()
  const service = serviceSnap.data()
  if (!service || !isCatalogService(service)) return { ok: false, error: 'Serviço não encontrado' }
  const serviceUnitSet = new Set(service.unitIds ?? [])

  const desired = new Set(professionalIds)
  const profsSnap = await tenantRef
    .collection('professionals')
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const updates: { proId: string; nextServiceIds: string[] }[] = []
  for (const doc of profsSnap.docs) {
    const pro = { ...doc.data(), id: doc.id }
    const has = (pro.serviceIds ?? []).includes(serviceId)
    const should = desired.has(pro.id)
    if (has === should) continue
    if (should) {
      const sharesUnit = (pro.unitIds ?? []).some((u) => serviceUnitSet.has(u))
      if (!sharesUnit) {
        // Resolve the name from the deletable PII doc only for the error.
        const enriched = await getProfessionalById(tenantId, pro.id)
        const proName = enriched?.name ?? 'Profissional'
        return {
          ok: false,
          error: `${proName} não atende em nenhuma unidade onde "${service.name}" é oferecido.`,
        }
      }
    }
    const nextServiceIds = should
      ? Array.from(new Set([...(pro.serviceIds ?? []), serviceId]))
      : (pro.serviceIds ?? []).filter((s) => s !== serviceId)
    updates.push({ proId: pro.id, nextServiceIds })
  }

  // Event-first: o vínculo pro↔serviço é estado do PROFISSIONAL — cada
  // profissional afetado emite `professional.updated`.
  for (const u of updates) {
    const res = await emitEvent(
      ProfessionalConfig,
      `tenants/${tenantId}/professionals/${u.proId}`,
      {
        _tag: 'professional.updated',
        actorId: r.ctx.session.uid,
        payload: { changes: { serviceIds: u.nextServiceIds } },
      },
    )
    if (!res.ok) return { ok: false, error: res.error }
  }
  revalidatePath(`/catalog/${serviceId}`)
  return { ok: true }
}
