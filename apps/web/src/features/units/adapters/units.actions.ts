'use server'

import {
  CatalogItem,
  isCatalogService,
  isValidUnitSlug,
  slugifyUnitName,
  StoredProfessional,
  StoredUnit,
} from '@/domain'
import { UnitConfig } from '@/domain/aggregates'
import { parseUnitForm } from '@/features/units/core/unit-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { canDeleteUnit } from '@/shared/tenant/delete-guard'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/tenant/membership'
import { deleteUnitPii, writeUnitPii } from '@/shared/tenant/unit-read'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type UnitMutationResult = { ok: true } | { ok: false; error: string }

const SLUG_MAX_ATTEMPTS = 50

// Returns a slug that is unique within the tenant's units collection, ignoring
// `selfUnitId` (so editing an unit keeps its current slug). Returns null when
// the user supplied an explicit `desired` and it collides — caller surfaces
// the error so the user can pick another. When `desired` is blank, derives
// from `name` and appends `-2`, `-3`, ... until free.
async function resolveUnitSlug({
  db,
  tenantId,
  desired,
  name,
  selfUnitId,
}: {
  db: ReturnType<typeof getAdminFirestore>
  tenantId: string
  desired: string
  name: string
  selfUnitId: string | null
}): Promise<string | null> {
  const unitsRef = db.collection('tenants').doc(tenantId).collection('units')
  async function isTaken(candidate: string): Promise<boolean> {
    const snap = await unitsRef.where('slug', '==', candidate).limit(2).get()
    return snap.docs.some((d) => d.id !== selfUnitId)
  }
  if (desired.length > 0) {
    return (await isTaken(desired)) ? null : desired
  }
  const base = slugifyUnitName(name) || 'unidade'
  // Defensive: derived base might collide with a reserved slug (e.g. unit
  // named "Book") — slap `-1` to escape the reserved set without bothering
  // the user mid-onboarding.
  const safeBase = isValidUnitSlug(base) ? base : `${base}-1`
  for (let i = 0; i < SLUG_MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? safeBase : `${safeBase}-${i + 1}`
    if (!isValidUnitSlug(candidate)) continue
    if (!(await isTaken(candidate))) return candidate
  }
  return null
}

export async function createUnit(formData: FormData): Promise<UnitMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const parsed = parseUnitForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const ref = db.collection('tenants').doc(r.ctx.membership.tenantId).collection('units').doc()
  const slug = await resolveUnitSlug({
    db,
    tenantId: r.ctx.membership.tenantId,
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
  // PII (whatsapp/email) never enters the event payload (LGPD). The
  // projection stores only operational fields; PII goes to the deletable
  // `units_pii` doc and is merged on read (unit-read.ts). #1036.
  const stored: StoredUnit = {
    id: ref.id,
    tenantId: r.ctx.membership.tenantId,
    name: parsed.name,
    slug,
    address: parsed.address,
    businessHours: parsed.businessHours,
    hoursMode: parsed.hoursMode,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await writeUnitPii(r.ctx.membership.tenantId, ref.id, {
    whatsapp: parsed.whatsapp,
    email: parsed.email,
  })
  const created = await emitEvent(
    UnitConfig,
    `tenants/${r.ctx.membership.tenantId}/units/${ref.id}`,
    { _tag: 'unit.created', actorId: r.ctx.session.uid, payload: { data: stored } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/units')
  // SPIKE (hours mode): the sidebar's "Agenda" visibility derives from unit
  // hoursMode (loaded in the shared (app) layout). Revalidate the layout too so
  // the nav reflects a mode change without a manual reload.
  revalidatePath('/', 'layout')
  redirect('/units')
}

export async function updateUnit(unitId: string, formData: FormData): Promise<UnitMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseUnitForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const slug = await resolveUnitSlug({
    db,
    tenantId: r.ctx.membership.tenantId,
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

  // PII goes to the deletable `units_pii` doc, never to the event.
  await writeUnitPii(r.ctx.membership.tenantId, unitId, {
    whatsapp: parsed.whatsapp,
    email: parsed.email,
  })
  const updated = await emitEvent(
    UnitConfig,
    `tenants/${r.ctx.membership.tenantId}/units/${unitId}`,
    {
      _tag: 'unit.updated',
      actorId: r.ctx.session.uid,
      payload: {
        changes: {
          name: parsed.name,
          slug,
          address: parsed.address,
          businessHours: parsed.businessHours,
          hoursMode: parsed.hoursMode,
        },
      },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/units')
  // SPIKE (hours mode): the sidebar's "Agenda" visibility derives from unit
  // hoursMode (loaded in the shared (app) layout). Revalidate the layout too so
  // the nav reflects a mode change without a manual reload.
  revalidatePath('/', 'layout')
  redirect('/units')
}

// Async availability probe for the Settings UI — returns OK if `slug` is
// free in the active tenant (ignoring `selfUnitId` so editing keeps the
// own slug as "available"). Final check still happens at write time.
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
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(r.ctx.membership.tenantId)
    .collection('units')
    .where('slug', '==', candidate)
    .limit(2)
    .get()
  const collides = snap.docs.some((d) => d.id !== selfUnitId)
  return collides ? { ok: true, available: false, reason: 'taken' } : { ok: true, available: true }
}

export async function deleteUnit(unitId: string): Promise<UnitMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const tenantId = r.ctx.membership.tenantId

  // One-verb "Excluir" (brief 0033, AC-03 — #1070): single destructive verb,
  // hard vs soft decided here. Active-reference guard (AC-01/AC-02): a live
  // dependency is a professional currently scoped to the unit, or a FUTURE
  // scheduled appointment in it. Past/completed/cancelled appointments are
  // historical (snapshotted) and do not block. With an active reference we
  // soft-delete (archive) — the unit drops from the active list while the
  // history is preserved. With no active reference we hard-delete.
  if (!(await canDeleteUnit(tenantId, unitId))) {
    return archiveUnit(unitId)
  }

  // Event-first: emite `deleted` (preserva stream, não reprojeta) e só então
  // remove o read model.
  const deleted = await emitEvent(UnitConfig, `tenants/${tenantId}/units/${unitId}`, {
    _tag: 'unit.deleted',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('units')
    .doc(unitId)
    .delete()
  // LGPD erasure — drop the PII doc alongside the projection.
  await deleteUnitPii(tenantId, unitId)
  revalidatePath('/units')
  return { ok: true }
}

// Archive a unit (uniform delete policy, brief 0027 AC-06). Sets `archivedAt`
// via the event-sourced `unit.archived` event — the doc stays resolvable for
// historical appointments/orders but drops out of active lists/pickers. The
// inverse (`restore`) passes `null`.
export async function archiveUnit(unitId: string, archived = true): Promise<UnitMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(UnitConfig, `tenants/${r.ctx.membership.tenantId}/units/${unitId}`, {
    _tag: 'unit.archived',
    actorId: r.ctx.session.uid,
    payload: { archivedAt },
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/units')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────────
// SPIKE: per-unit agenda readiness (inferred availability, no publish button).
// A unit in 'appointment' mode goes live once it meets the minimum below; this
// helper feeds the read-only feedback card on the unit page.
// ────────────────────────────────────────────────────────────────────────

export type UnitPublishReadiness = { ready: boolean; missing: string[] }

const UNIT_REQUIREMENTS = {
  address: 'Endereço e horário de funcionamento preenchidos',
  service: '1 serviço público oferecido nesta unidade',
  professional: '1 profissional aprovado nesta unidade',
} as const

// Readiness scoped to a single unit — the requirement set the tenant-wide gate
// used to check globally, now evaluated for exactly the unit being published.
export async function getUnitPublishReadiness(
  tenantId: string,
  unitId: string,
): Promise<UnitPublishReadiness> {
  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenantId)
  const [unitSnap, servicesSnap, prosSnap] = await Promise.all([
    tenantRef.collection('units').withConverter(fsConverter(StoredUnit)).doc(unitId).get(),
    tenantRef.collection('catalog_items').withConverter(fsConverter(CatalogItem)).get(),
    tenantRef.collection('professionals').withConverter(fsConverter(StoredProfessional)).get(),
  ])

  const unit = unitSnap.data()
  const hasAddressAndHours = unit?.address != null && unit?.businessHours != null
  const hasPublicService = servicesSnap.docs
    .map((d) => d.data())
    .filter(isCatalogService)
    .some(
      (s) => s.active && s.publicVisible && Array.isArray(s.unitIds) && s.unitIds.includes(unitId),
    )
  const hasOperationalPro = prosSnap.docs
    .map((d) => d.data())
    .some((p) => p.operationalStatus === 'operational' && p.unitIds.includes(unitId))

  const missing: string[] = []
  if (!hasAddressAndHours) missing.push(UNIT_REQUIREMENTS.address)
  if (!hasPublicService) missing.push(UNIT_REQUIREMENTS.service)
  if (!hasOperationalPro) missing.push(UNIT_REQUIREMENTS.professional)
  return { ready: missing.length === 0, missing }
}
