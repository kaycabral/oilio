'use server'

import {
  type CatalogItem,
  type CatalogItemKind,
  type MemberOperation,
  type ServicePriceVisibility,
  isCatalogService,
  normalizeCatalogItemKind,
  normalizeServicePriceVisibility,
} from '@/domain'
import { CatalogItemConfig, MemberOperationConfig } from '@/domain/aggregates'
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
import { classifyError } from '@/shared/errors/classify'
import { messageForCategory } from '@/shared/errors/messages'
import { formString } from '@/shared/form-data'
import { getCategoryById } from '@/shared/org/category-read'
import { canDeleteCatalogItem } from '@/shared/org/delete-guard'
import {
  getMemberOperationById,
  listMemberOperationIdsForService,
} from '@/shared/org/member-operation-read'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { listUnitIds } from '@/shared/org/unit-read'
import { runProductGate } from '@/shared/product'
import { revalidatePath } from 'next/cache'

export type CatalogItemMutationResult = { ok: true } | { ok: false; error: string }

type StoredFields = 'id' | 'orgId' | 'archivedAt' | 'createdAt' | 'updatedAt'
type CatalogItemPayload = CatalogItem extends infer T
  ? T extends CatalogItem
    ? Omit<T, StoredFields>
    : never
  : never

async function orgUnitIds(orgId: string): Promise<Set<string>> {
  return new Set(await listUnitIds(orgId))
}

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
    gtin14: null,
  }
}

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

  if (!(await canDeleteCatalogItem(orgId, catalogItemId))) {
    return archiveCatalogItem(catalogItemId)
  }

  const deleted = await emitEvent(
    CatalogItemConfig,
    aggregateRef(CatalogItemConfig, orgId, catalogItemId),
    { _tag: 'catalog_item.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  try {
    await deleteOrgProjectionDoc(aggregateRef(CatalogItemConfig, orgId, catalogItemId))
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: 'Não é possível excluir este item: há agendamentos vinculados a ele.',
      }
    }
    return { ok: false as const, error: messageForCategory(classifyError(err)) }
  }
  revalidatePath('/catalog')
  return { ok: true }
}

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

function nextCatalogServiceIdsFor(
  pro: MemberOperation,
  service: { id: string; name: string; unitSet: ReadonlySet<string> },
  should: boolean,
): { ids: string[] } | { error: string } {
  if (should) {
    const sharesUnit = (pro.unitIds ?? []).some((u) => service.unitSet.has(u))
    if (!sharesUnit) {
      const proName = pro.name || 'Profissional'
      return {
        error: `${proName} não atende em nenhuma unidade onde "${service.name}" é oferecido.`,
      }
    }
    return { ids: Array.from(new Set([...(pro.catalogServiceIds ?? []), service.id])) }
  }
  return { ids: (pro.catalogServiceIds ?? []).filter((s) => s !== service.id) }
}

export async function setServiceMemberOperations(
  serviceId: string,
  memberOperationIds: string[],
): Promise<CatalogItemMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const service = await getCatalogItemById(orgId, serviceId)
  if (!service || !isCatalogService(service)) return { ok: false, error: 'Serviço não encontrado' }
  const serviceUnitSet = new Set(service.unitIds ?? [])

  const desired = new Set(memberOperationIds)
  const currentlyLinked = new Set(await listMemberOperationIdsForService(orgId, serviceId))
  const affectedIds = [...new Set([...desired, ...currentlyLinked])]
  const updates: { proId: string; nextCatalogServiceIds: string[] }[] = []
  for (const proId of affectedIds) {
    const has = currentlyLinked.has(proId)
    const should = desired.has(proId)
    if (has === should) continue
    const pro = await getMemberOperationById(orgId, proId)
    if (!pro) continue
    const next = nextCatalogServiceIdsFor(
      pro,
      { id: serviceId, name: service.name, unitSet: serviceUnitSet },
      should,
    )
    if ('error' in next) return { ok: false, error: next.error }
    updates.push({ proId: pro.id, nextCatalogServiceIds: next.ids })
  }

  for (const u of updates) {
    const res = await emitEvent(
      MemberOperationConfig,
      aggregateRef(MemberOperationConfig, orgId, u.proId),
      {
        _tag: 'member_operation.updated',
        actorId: r.ctx.session.uid,
        payload: { changes: { catalogServiceIds: u.nextCatalogServiceIds } },
      },
    )
    if (!res.ok) return { ok: false, error: res.error }
  }
  revalidatePath(`/catalog/${serviceId}`)
  return { ok: true }
}
