'use server'

import {
  DEFAULT_UNIT_FISCAL,
  inferTimezoneFromAddress,
  isCatalogService,
  isValidUnitSlug,
  slugifyUnitName,
  type StoredUnit,
} from '@/domain'
import { UnitConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { assertActiveUnitQuota } from '@/features/units/adapters/units-quota'
import {
  computeUnitPublishReadiness,
  unitHasAddressAndHours,
  type UnitPublishReadiness,
} from '@/features/units/core/publish-readiness'
import {
  assembleAgenda,
  parseAppointmentConfig,
  parseUnitForm,
} from '@/features/units/core/unit-form'
import { syncStripeSubscriptionQuantity } from '@/shared/billing/stripe-sync'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { deletePostgresProjection } from '@/shared/db/pg/effect/postgres-layer'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { classifyError } from '@/shared/errors/classify'
import { messageForCategory } from '@/shared/errors/messages'
import { canDeleteUnit } from '@/shared/org/delete-guard'
import { hasOperationalMemberOperationInUnit } from '@/shared/org/member-operation-read'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { deleteUnitPii, getUnitById, listUnitSlugs, writeUnitPii } from '@/shared/org/unit-read'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type UnitMutationResult = { ok: true } | { ok: false; error: string }

const SLUG_MAX_ATTEMPTS = 50

async function resolveUnitSlug({
  orgId,
  desired,
  name,
  selfUnitId,
}: {
  orgId: string
  desired: string
  name: string
  selfUnitId: string | null
}): Promise<string | null> {
  const existing = await listUnitSlugs(orgId)
  function isTaken(candidate: string): boolean {
    return existing.some((u) => u.slug === candidate && u.id !== selfUnitId)
  }
  if (desired.length > 0) {
    return isTaken(desired) ? null : desired
  }
  const base = slugifyUnitName(name) || 'unidade'
  const safeBase = isValidUnitSlug(base) ? base : `${base}-1`
  for (let i = 0; i < SLUG_MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? safeBase : `${safeBase}-${i + 1}`
    if (!isValidUnitSlug(candidate)) continue
    if (!isTaken(candidate)) return candidate
  }
  return null
}

export async function createUnit(formData: FormData): Promise<UnitMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const quotaError = await assertActiveUnitQuota(orgId)
  if (quotaError) return { ok: false, error: quotaError }

  const parsed = parseUnitForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const unitId = newId()
  const slug = await resolveUnitSlug({
    orgId: r.ctx.membership.orgId,
    desired: parsed.slug,
    name: parsed.name,
    selfUnitId: null,
  })
  if (!slug) {
    return {
      ok: false,
      error: parsed.slug
        ? `Slug "${parsed.slug}" já está em uso nesta empresa. Escolha outro.`
        : 'Não foi possível gerar um slug único a partir do nome. Edite o slug manualmente.',
    }
  }
  const now = new Date().toISOString()
  const stored: StoredUnit = {
    id: unitId,
    orgId: r.ctx.membership.orgId,
    name: parsed.name,
    slug,
    address: parsed.address,
    timezone: inferTimezoneFromAddress(parsed.address.state, parsed.address.city),
    agenda: assembleAgenda(
      parsed.hoursMode,
      parsed.businessHours,
      null,
      parsed.hoursMode === 'appointment' ? parseAppointmentConfig(formData) : null,
    ),
    archivedAt: null,
    fiscal: DEFAULT_UNIT_FISCAL,
    createdAt: now,
    updatedAt: now,
  }
  await writeUnitPii(r.ctx.membership.orgId, unitId, {
    mobile: parsed.mobile,
    email: parsed.email,
  })
  const created = await emitEvent(
    UnitConfig,
    aggregateRef(UnitConfig, r.ctx.membership.orgId, unitId),
    {
      _tag: 'unit.created',
      actorId: r.ctx.session.uid,
      payload: { data: stored },
    },
  )
  if (!created.ok) return { ok: false, error: created.error }
  await syncStripeSubscriptionQuantity(orgId)
  revalidatePath('/organizations')
  revalidatePath('/', 'layout')
  redirect('/organizations')
}

export async function updateUnit(unitId: string, formData: FormData): Promise<UnitMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseUnitForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const existing = await getUnitById(r.ctx.membership.orgId, unitId)
  if (!existing) return { ok: false, error: 'Unidade não encontrada' }

  const slug = await resolveUnitSlug({
    orgId: r.ctx.membership.orgId,
    desired: parsed.slug,
    name: parsed.name,
    selfUnitId: unitId,
  })
  if (!slug) {
    return {
      ok: false,
      error: parsed.slug
        ? `Slug "${parsed.slug}" já está em uso nesta empresa. Escolha outro.`
        : 'Não foi possível gerar um slug único a partir do nome. Edite o slug manualmente.',
    }
  }

  await writeUnitPii(r.ctx.membership.orgId, unitId, {
    mobile: parsed.mobile,
    email: parsed.email,
  })
  const updated = await emitEvent(
    UnitConfig,
    aggregateRef(UnitConfig, r.ctx.membership.orgId, unitId),
    {
      _tag: 'unit.updated',
      actorId: r.ctx.session.uid,
      payload: {
        changes: {
          name: parsed.name,
          slug,
          address: parsed.address,
          timezone: inferTimezoneFromAddress(parsed.address.state, parsed.address.city),
          agenda: assembleAgenda(
            parsed.hoursMode,
            parsed.businessHours,
            existing.agenda,
            parsed.hoursMode === 'appointment' ? parseAppointmentConfig(formData) : null,
          ),
        },
      },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/organizations')
  revalidatePath('/', 'layout')
  redirect('/organizations')
}

export type SlugCheck =
  | { ok: true; available: true }
  | { ok: true; available: false; reason: 'taken' | 'reserved' | 'invalid' }
  | { ok: false; error: string }

export async function checkUnitSlugAvailability(
  slug: string,
  selfUnitId: string | null,
): Promise<SlugCheck> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const candidate = slug.trim().toLowerCase()
  if (candidate.length === 0) return { ok: true, available: false, reason: 'invalid' }
  if (!isValidUnitSlug(candidate)) {
    return { ok: true, available: false, reason: 'invalid' }
  }
  const existing = await listUnitSlugs(r.ctx.membership.orgId)
  const collides = existing.some((u) => u.slug === candidate && u.id !== selfUnitId)
  return collides ? { ok: true, available: false, reason: 'taken' } : { ok: true, available: true }
}

export async function deleteUnit(unitId: string): Promise<UnitMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  if (!(await canDeleteUnit(orgId, unitId))) {
    return archiveUnit(unitId)
  }

  const deleted = await emitEvent(UnitConfig, aggregateRef(UnitConfig, orgId, unitId), {
    _tag: 'unit.deleted',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!deleted.ok) return { ok: false, error: deleted.error }
  try {
    await deletePostgresProjection(aggregateRef(UnitConfig, orgId, unitId))
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error:
          'Não é possível excluir esta unidade: há registros vinculados a ela (vendas, assinaturas, agendamentos ou caixa). Arquive-a ou remova os dependentes primeiro.',
      }
    }
    return { ok: false as const, error: messageForCategory(classifyError(err)) }
  }
  await deleteUnitPii(orgId, unitId)
  await syncStripeSubscriptionQuantity(orgId)
  revalidatePath('/organizations')
  return { ok: true }
}

export async function archiveUnit(unitId: string, archived = true): Promise<UnitMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  if (!archived) {
    const quotaError = await assertActiveUnitQuota(orgId)
    if (quotaError) return { ok: false, error: quotaError }
  }
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    UnitConfig,
    aggregateRef(UnitConfig, r.ctx.membership.orgId, unitId),
    {
      _tag: 'unit.archived',
      actorId: r.ctx.session.uid,
      payload: { archivedAt },
    },
  )
  if (!res.ok) return { ok: false, error: res.error }
  await syncStripeSubscriptionQuantity(r.ctx.membership.orgId)
  revalidatePath('/organizations')
  return { ok: true }
}

export async function getUnitPublishReadiness(
  orgId: string,
  unitId: string,
): Promise<UnitPublishReadiness> {
  const [unit, catalogItems, hasOperationalMemberOperation] = await Promise.all([
    getUnitById(orgId, unitId),
    listCatalogItems(orgId),
    hasOperationalMemberOperationInUnit(orgId, unitId),
  ])

  const hasPublicService = catalogItems
    .filter(isCatalogService)
    .some(
      (s) => s.active && s.publicVisible && Array.isArray(s.unitIds) && s.unitIds.includes(unitId),
    )

  return computeUnitPublishReadiness({
    hasAddressAndHours: unit != null && unitHasAddressAndHours(unit),
    hasPublicService,
    hasOperationalMemberOperation,
  })
}
