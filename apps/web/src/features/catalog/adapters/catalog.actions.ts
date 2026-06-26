'use server'

import {
  type CatalogItem,
  type CatalogItemKind,
  type Professional,
  type ServicePriceVisibility,
  isCatalogService,
  normalizeCatalogItemKind,
  normalizeServicePriceVisibility,
} from '@/domain'
import { CatalogItemConfig, ProfessionalConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  parseCommissionFromForm,
  parseUnitOverrides,
} from '@/features/catalog/core/catalog-item-form'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { getCategoryById } from '@/shared/org/category-read'
import { canDeleteCatalogItem } from '@/shared/org/delete-guard'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { getProfessionalById, listProfessionalIdsForService } from '@/shared/org/professional-read'
import { listUnitIds } from '@/shared/org/unit-read'
import { runProductGate } from '@/shared/product'
import { revalidatePath } from 'next/cache'

// Unified catalog CRUD (brief 0023, AC-02). Mirrors the service/product server
// actions but writes a single `catalog_items` collection discriminated by
// `kind`. Services/products keep their own routes + collections until the
// consumer migration (#1004) and UI convergence (#1005) land — this slice only
// ADDS the unified model.

export type CatalogItemMutationResult = { ok: true } | { ok: false; error: string }

// Distributive Omit: keeps the discriminated union intact (each member keeps
// its kind-specific fields) instead of collapsing to the common keys only.
type StoredFields = 'id' | 'orgId' | 'archivedAt' | 'createdAt' | 'updatedAt'
type CatalogItemPayload = CatalogItem extends infer T
  ? T extends CatalogItem
    ? Omit<T, StoredFields>
    : never
  : never

async function orgUnitIds(orgId: string): Promise<Set<string>> {
  return new Set(await listUnitIds(orgId))
}

// AC-04: `categoryId` is a real FK into `orgs/{orgId}/categories/{id}`.
// Defense in depth — like the unit check above, the server action validates the
// referenced category exists in this org before accepting the write so a
// crafted form can't point an item at a nonexistent/foreign category.
async function orgCategoryExists(orgId: string, categoryId: string): Promise<boolean> {
  return (await getCategoryById(orgId, categoryId)) !== null
}

async function parseCatalogItemForm(
  orgId: string,
  formData: FormData,
): Promise<CatalogItemPayload | string> {
  const kind: CatalogItemKind = normalizeCatalogItemKind(formData.get('kind'))

  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const categoryId = formString(formData, 'categoryId').trim() || null
  if (categoryId !== null && !(await orgCategoryExists(orgId, categoryId))) {
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
  const known = await orgUnitIds(orgId)
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
    // Default. The sovereign-base gate (createCatalogItem) resolves the raw GTIN
    // and overrides this with the canonical GTIN-14 when valid; it stays null
    // when the GTIN is absent/rejected, or when the base is unavailable.
    gtin14: null,
  }
}

// Strip the gate-owned `gtin14` from a parsed product payload before it becomes
// an `updated` patch — the edit form never carries a real GTIN, so its
// always-null `gtin14` must not overwrite the resolved reference. The result is
// a partial patch (a subset of the item's fields), which is exactly what
// `catalog_item.updated`'s `changes` accepts.
function omitGtinFields(
  parsed: CatalogItemPayload & { kind: 'product' },
): Omit<CatalogItemPayload & { kind: 'product' }, 'gtin14'> {
  const { gtin14: _gtin14, ...rest } = parsed
  return rest
}

export async function createCatalogItem(formData: FormData): Promise<CatalogItemMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  const parsed = await parseCatalogItemForm(orgId, formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Sovereign-base gate (brief 0050, AC-05): runs at REGISTRATION (here), not at
  // sale. For a product with a GTIN, resolve it against the base — reference a
  // known product or auto-contribute a valid+unseen one — and stash the canonical
  // GTIN-14 on the item. Best-effort: a base outage never blocks the cadastro.
  const productFields =
    parsed.kind === 'product'
      ? await runProductGate(formString(formData, 'gtin'), { name: parsed.name })
      : {}

  const id = newId()
  const now = new Date().toISOString()
  const item = {
    id,
    orgId,
    ...parsed,
    ...productFields,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  } as CatalogItem
  const created = await emitEvent(CatalogItemConfig, aggregateRef(CatalogItemConfig, orgId, id), {
    _tag: 'catalog_item.created',
    actorId: r.ctx.session.uid,
    payload: { data: item },
  })
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
  const orgId = r.ctx.membership.orgId
  const parsed = await parseCatalogItemForm(orgId, formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // The sovereign-base reference (`gtin14`) and its reconciliation marker are
  // owned by the gate (createCatalogItem) + the reconciliation cron, NOT the
  // edit form — `parseCatalogItemForm` always emits `gtin14: null` for products,
  // so spreading it here would clobber a resolved reference to null on every
  // edit (and orphan a reconciliation-pending item). Drop it from the changes.
  const changes = parsed.kind === 'product' ? omitGtinFields(parsed) : parsed

  const updated = await emitEvent(
    CatalogItemConfig,
    aggregateRef(CatalogItemConfig, orgId, catalogItemId),
    {
      _tag: 'catalog_item.updated',
      actorId: r.ctx.session.uid,
      payload: { changes },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/catalog')
  return { ok: true }
}

export async function deleteCatalogItem(catalogItemId: string): Promise<CatalogItemMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  // One-verb "Excluir" (brief 0033, AC-03 — #1070): single destructive verb,
  // hard vs soft decided here. Active-reference guard (AC-01/AC-02): a live
  // consumer is an OPEN order with a line item referencing it, or an ACTIVE
  // subscription whose frozen coverage snapshot includes it. Membership in a
  // plan *definition* (`includedItemIds`) is editable config, not an active
  // reference; closed/cancelled orders are historical and snapshotted. With an
  // active reference we soft-delete (archive) — the item drops from the active
  // catalog while open comandas/active subscriptions keep their frozen snapshot.
  // With no active reference we hard-delete.
  if (!(await canDeleteCatalogItem(orgId, catalogItemId))) {
    return archiveCatalogItem(catalogItemId)
  }

  const deleted = await emitEvent(
    CatalogItemConfig,
    aggregateRef(CatalogItemConfig, orgId, catalogItemId),
    { _tag: 'catalog_item.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  // Hard-delete the read-model row. The `*.deleted` event is kept in the stream;
  // the projection write is skipped by the event store, so the row is dropped
  // here — removes the Postgres typed `catalog_items` projection row (brief 0058).
  // `canDeleteCatalogItem` already routes active consumers to archive, but a
  // cross-aggregate `ON DELETE RESTRICT` FK (brief 0068 D2 — appointments whose
  // `service_id` references this item) is the DB's last-line guard: convert its
  // 23503 into a friendly result instead of a raw 500.
  try {
    await deleteOrgProjectionDoc(aggregateRef(CatalogItemConfig, orgId, catalogItemId))
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: 'Não é possível excluir este item: há agendamentos vinculados a ele.',
      }
    }
    throw err
  }
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
    aggregateRef(CatalogItemConfig, r.ctx.membership.orgId, catalogItemId),
    { _tag: 'catalog_item.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/catalog')
  return { ok: true }
}

// Service item ↔ professional link (brief 0023, #1005). Moved here from the
// now-deleted `/services` route (AC-10) — `/catalog` is the single place to
// manage items, including which professionals execute a service. Reads the
// unified `catalog_items` collection and writes the `catalogServiceIds` membership on
// each affected professional (event-sourced, `professional.updated`).
//
// Cross-edit reached from a service item's catalog editor. Enforces the #876
// invariant (`item.unitIds ∩ Professional.unitIds ≠ ∅`) before flipping each
// pro's `catalogServiceIds` membership. Atomic per-pro: each affected professional
// gets a single document write.
// Resolve the next `catalogServiceIds` array for one professional whose link to
// `service` flips. `should=true` enforces the #876 invariant (`item.unitIds ∩
// Professional.unitIds ≠ ∅`) and returns an error message string when violated;
// otherwise returns the next array. Pure given the loaded professional.
function nextCatalogServiceIdsFor(
  pro: Professional,
  service: { id: string; name: string; unitSet: ReadonlySet<string> },
  should: boolean,
): { ids: string[] } | { error: string } {
  if (should) {
    const sharesUnit = (pro.unitIds ?? []).some((u) => service.unitSet.has(u))
    if (!sharesUnit) {
      // The enriched read already carries the professional's name.
      const proName = pro.name || 'Profissional'
      return {
        error: `${proName} não atende em nenhuma unidade onde "${service.name}" é oferecido.`,
      }
    }
    return { ids: Array.from(new Set([...(pro.catalogServiceIds ?? []), service.id])) }
  }
  return { ids: (pro.catalogServiceIds ?? []).filter((s) => s !== service.id) }
}

export async function setServiceProfessionals(
  serviceId: string,
  professionalIds: string[],
): Promise<CatalogItemMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const service = await getCatalogItemById(orgId, serviceId)
  if (!service || !isCatalogService(service)) return { ok: false, error: 'Serviço não encontrado' }
  const serviceUnitSet = new Set(service.unitIds ?? [])

  const desired = new Set(professionalIds)
  // "Who already performs this service?" — the inverse query served by the
  // `professional_services` join (brief 0068 D3), replacing a fetch-all + JS
  // `.includes()`. The WRITE still flows through `professional.updated` (the
  // `catalogServiceIds` array in the reduced state) — only this READ migrates.
  const currentlyLinked = new Set(await listProfessionalIdsForService(orgId, serviceId))
  // Only professionals whose membership actually flips matter: the union of the
  // desired set and those currently linked. Load just those (not every pro).
  const affectedIds = [...new Set([...desired, ...currentlyLinked])]
  const updates: { proId: string; nextCatalogServiceIds: string[] }[] = []
  for (const proId of affectedIds) {
    const has = currentlyLinked.has(proId)
    const should = desired.has(proId)
    if (has === should) continue
    const pro = await getProfessionalById(orgId, proId)
    // `should && !has` with a missing professional → the toggle targets a
    // professional that no longer exists; skip rather than emit against a ghost.
    if (!pro) continue
    const next = nextCatalogServiceIdsFor(
      pro,
      { id: serviceId, name: service.name, unitSet: serviceUnitSet },
      should,
    )
    if ('error' in next) return { ok: false, error: next.error }
    updates.push({ proId: pro.id, nextCatalogServiceIds: next.ids })
  }

  // Event-first: o vínculo pro↔serviço é estado do PROFISSIONAL — cada
  // profissional afetado emite `professional.updated`.
  for (const u of updates) {
    const res = await emitEvent(
      ProfessionalConfig,
      aggregateRef(ProfessionalConfig, orgId, u.proId),
      {
        _tag: 'professional.updated',
        actorId: r.ctx.session.uid,
        payload: { changes: { catalogServiceIds: u.nextCatalogServiceIds } },
      },
    )
    if (!res.ok) return { ok: false, error: res.error }
  }
  revalidatePath(`/catalog/${serviceId}`)
  return { ok: true }
}
