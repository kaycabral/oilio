'use server'

import {
  CatalogItem,
  DEFAULT_UNIT_FISCAL,
  inferTimezoneFromAddress,
  isCatalogService,
  isValidUnitSlug,
  slugifyUnitName,
  StoredProfessional,
  StoredUnit,
} from '@/domain'
import { UnitConfig } from '@/domain/aggregates'
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
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { canDeleteUnit } from '@/shared/org/delete-guard'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { deleteUnitPii, getUnitById, writeUnitPii } from '@/shared/org/unit-read'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type UnitMutationResult = { ok: true } | { ok: false; error: string }

const SLUG_MAX_ATTEMPTS = 50

// Returns a slug that is unique within the org's units collection, ignoring
// `selfUnitId` (so editing an unit keeps its current slug). Returns null when
// the user supplied an explicit `desired` and it collides — caller surfaces
// the error so the user can pick another. When `desired` is blank, derives
// from `name` and appends `-2`, `-3`, ... until free.
async function resolveUnitSlug({
  db,
  orgId,
  desired,
  name,
  selfUnitId,
}: {
  db: ReturnType<typeof getAdminFirestore>
  orgId: string
  desired: string
  name: string
  selfUnitId: string | null
}): Promise<string | null> {
  const unitsRef = db.collection('orgs').doc(orgId).collection('units')
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
  const ref = db.collection('orgs').doc(r.ctx.membership.orgId).collection('units').doc()
  const slug = await resolveUnitSlug({
    db,
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
  // PII (whatsapp/email) never enters the event payload (LGPD). The
  // projection stores only operational fields; PII goes to the deletable
  // `units_pii` doc and is merged on read (unit-read.ts). #1036.
  const stored: StoredUnit = {
    id: ref.id,
    orgId: r.ctx.membership.orgId,
    name: parsed.name,
    slug,
    address: parsed.address,
    // Timezone is the establishment's (PRD Identidade v2 — moved Org→Unit):
    // inferred from the address state (BR UFs); the unit form has no tz picker.
    timezone: inferTimezoneFromAddress(parsed.address.state, parsed.address.city),
    agenda: assembleAgenda(
      parsed.hoursMode,
      parsed.businessHours,
      null,
      parsed.hoursMode === 'appointment' ? parseAppointmentConfig(formData) : null,
    ),
    archivedAt: null,
    // A new unit is born informal — no CNPJ until the owner formalizes it via
    // the Formalizar flow (`unit.formalized`, brief 0048).
    fiscal: DEFAULT_UNIT_FISCAL,
    createdAt: now,
    updatedAt: now,
  }
  await writeUnitPii(r.ctx.membership.orgId, ref.id, {
    whatsapp: parsed.whatsapp,
    email: parsed.email,
  })
  const created = await emitEvent(UnitConfig, `orgs/${r.ctx.membership.orgId}/units/${ref.id}`, {
    _tag: 'unit.created',
    actorId: r.ctx.session.uid,
    payload: { data: stored },
  })
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/negocios')
  // SPIKE (hours mode): the sidebar's "Agenda" visibility derives from unit
  // hoursMode (loaded in the shared (app) layout). Revalidate the layout too so
  // the nav reflects a mode change without a manual reload.
  revalidatePath('/', 'layout')
  redirect('/negocios')
}

export async function updateUnit(unitId: string, formData: FormData): Promise<UnitMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseUnitForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Load the existing unit so the agenda assembly preserves the
  // appointment-only configs (slotMinutes/cancellationPolicy/templates/publish
  // state) that the unit form doesn't expose. PRD Identidade v2.
  const existing = await getUnitById(r.ctx.membership.orgId, unitId)
  if (!existing) return { ok: false, error: 'Unidade não encontrada' }

  const db = getAdminFirestore()
  const slug = await resolveUnitSlug({
    db,
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

  // PII goes to the deletable `units_pii` doc, never to the event.
  await writeUnitPii(r.ctx.membership.orgId, unitId, {
    whatsapp: parsed.whatsapp,
    email: parsed.email,
  })
  const updated = await emitEvent(UnitConfig, `orgs/${r.ctx.membership.orgId}/units/${unitId}`, {
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
  })
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/negocios')
  // SPIKE (hours mode): the sidebar's "Agenda" visibility derives from unit
  // hoursMode (loaded in the shared (app) layout). Revalidate the layout too so
  // the nav reflects a mode change without a manual reload.
  revalidatePath('/', 'layout')
  redirect('/negocios')
}

// Async availability probe for the Settings UI — returns OK if `slug` is
// free in the active org (ignoring `selfUnitId` so editing keeps the
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
    .collection('orgs')
    .doc(r.ctx.membership.orgId)
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
  const orgId = r.ctx.membership.orgId

  // One-verb "Excluir" (brief 0033, AC-03 — #1070): single destructive verb,
  // hard vs soft decided here. Active-reference guard (AC-01/AC-02): a live
  // dependency is a professional currently scoped to the unit, or a FUTURE
  // scheduled appointment in it. Past/completed/cancelled appointments are
  // historical (snapshotted) and do not block. With an active reference we
  // soft-delete (archive) — the unit drops from the active list while the
  // history is preserved. With no active reference we hard-delete.
  if (!(await canDeleteUnit(orgId, unitId))) {
    return archiveUnit(unitId)
  }

  // Event-first: emite `deleted` (preserva stream, não reprojeta) e só então
  // remove o read model.
  const deleted = await emitEvent(UnitConfig, `orgs/${orgId}/units/${unitId}`, {
    _tag: 'unit.deleted',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await getAdminFirestore().collection('orgs').doc(orgId).collection('units').doc(unitId).delete()
  // LGPD erasure — drop the PII doc alongside the projection.
  await deleteUnitPii(orgId, unitId)
  revalidatePath('/negocios')
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
  const res = await emitEvent(UnitConfig, `orgs/${r.ctx.membership.orgId}/units/${unitId}`, {
    _tag: 'unit.archived',
    actorId: r.ctx.session.uid,
    payload: { archivedAt },
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/negocios')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────────
// SPIKE: per-unit agenda readiness (inferred availability, no publish button).
// A unit in 'appointment' mode goes live once it meets the minimum below; this
// helper feeds the read-only feedback card on the unit page.
// ────────────────────────────────────────────────────────────────────────

// Readiness scoped to a single unit — the requirement set the org-wide gate
// used to check globally, now evaluated for exactly the unit being published.
// The pure decision lives in the functional core (`computeUnitPublishReadiness`);
// this shell only resolves the three facts from Firestore.
export async function getUnitPublishReadiness(
  orgId: string,
  unitId: string,
): Promise<UnitPublishReadiness> {
  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const [unitSnap, servicesSnap, prosSnap] = await Promise.all([
    orgRef.collection('units').withConverter(fsConverter(StoredUnit)).doc(unitId).get(),
    orgRef.collection('catalog_items').withConverter(fsConverter(CatalogItem)).get(),
    orgRef.collection('professionals').withConverter(fsConverter(StoredProfessional)).get(),
  ])

  const unit = unitSnap.data()
  const hasPublicService = servicesSnap.docs
    .map((d) => d.data())
    .filter(isCatalogService)
    .some(
      (s) => s.active && s.publicVisible && Array.isArray(s.unitIds) && s.unitIds.includes(unitId),
    )
  const hasOperationalProfessional = prosSnap.docs
    .map((d) => d.data())
    .some((p) => p.operationalStatus === 'operational' && p.unitIds.includes(unitId))

  return computeUnitPublishReadiness({
    hasAddressAndHours: unit != null && unitHasAddressAndHours(unit.agenda),
    hasPublicService,
    hasOperationalProfessional,
  })
}

// --- Per-unit self-booking publication (brief 0008 #988) ----------------------
//
// Self-booking publish is a per-unit appointment-agenda concern (PRD Identidade
// v2 — moved Org→Unit). Replaces the Org-level `org.self_booking_*` events with
// `unit.self_booking_published`/`unpublished`. The publish state lives in the
// `appointment` variant of `Unit.agenda`; publishing a unit that isn't in
// appointment mode is rejected (the flag doesn't exist there).

export type UnitPublishResult = { ok: true } | { ok: false; error: string }

export async function publishUnitSelfBooking(unitId: string): Promise<UnitPublishResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const unit = await getUnitById(orgId, unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }
  if (unit.agenda.mode !== 'appointment') {
    return { ok: false, error: 'A unidade não usa a agenda online' }
  }
  // AC-07: server revalidates the minimum before publishing (defense in depth —
  // never trust the UI checklist).
  const readiness = await getUnitPublishReadiness(orgId, unitId)
  if (!readiness.ready) {
    return { ok: false, error: `Faltam requisitos: ${readiness.missing.join('; ')}` }
  }

  // Event-first: the publication state is a dedicated domain event; the reducer
  // projects `agenda.selfBookingPublished`. Auditoria = stream (actorId no
  // evento) — sem recordAudit.
  const published = await emitEvent(UnitConfig, `orgs/${orgId}/units/${unitId}`, {
    _tag: 'unit.self_booking_published',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!published.ok) return { ok: false, error: published.error }

  revalidatePath('/negocios')
  return { ok: true }
}

export async function unpublishUnitSelfBooking(unitId: string): Promise<UnitPublishResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const unpublished = await emitEvent(UnitConfig, `orgs/${orgId}/units/${unitId}`, {
    _tag: 'unit.self_booking_unpublished',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!unpublished.ok) return { ok: false, error: unpublished.error }

  revalidatePath('/negocios')
  return { ok: true }
}
