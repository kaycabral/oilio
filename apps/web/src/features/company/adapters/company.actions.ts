'use server'

import {
  CatalogItem,
  isCatalogService,
  isValidSlug,
  StoredProfessional,
  StoredUnit,
  type Vertical,
  VERTICALS,
} from '@/domain'
import { OrgConfig } from '@/domain/aggregates'
import {
  parseBranding,
  parseCancellationPolicy,
  parseWhatsappTemplates,
} from '@/features/company/core/company-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'

function isVertical(value: string): value is Vertical {
  return (VERTICALS as readonly string[]).includes(value)
}

export type UpdateCompanyResult = { ok: true } | { ok: false; error: string }

export async function updateCompany(formData: FormData): Promise<UpdateCompanyResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const name = formString(formData, 'name').trim()
  const slug = formString(formData, 'slug').trim().toLowerCase()
  const verticalRaw = formString(formData, 'vertical')
  if (name.length < 2) return { ok: false, error: 'Name is too short' }
  if (!isValidSlug(slug)) {
    return { ok: false, error: 'Slug deve ter 3+ caracteres: minúsculas, dígitos e hífens' }
  }
  if (!isVertical(verticalRaw)) return { ok: false, error: 'Invalid vertical' }
  const vertical: Vertical = verticalRaw

  const db = getAdminFirestore()
  const orgId = r.ctx.membership.orgId
  const slugTaken = await db.collection('orgs').where('slug', '==', slug).limit(1).get()
  if (!slugTaken.empty && slugTaken.docs[0]?.id !== orgId) {
    return { ok: false, error: 'Slug já está em uso' }
  }

  // Fiscal identity is NOT edited here anymore (brief 0048): an informal Org
  // formalizes via the dedicated Formalizar flow (`formalize.actions`), and a
  // formalized Org's fiscal data is read-only. This action only edits the
  // operational/identity fields below.
  const cancellation = parseCancellationPolicy(formData)
  if (typeof cancellation === 'string') return { ok: false, error: cancellation }
  const branding = parseBranding(formData)
  if (typeof branding === 'string') return { ok: false, error: branding }

  // Event-first: estado da empresa vem do evento (sem `.update` paralelo); o
  // reducer projeta todas as mudanças.
  const updated = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.updated',
    actorId: r.ctx.session.uid,
    payload: {
      changes: {
        name,
        slug,
        vertical,
        ...branding,
        ...cancellation,
        ...parseWhatsappTemplates(formData),
      },
    },
  })
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/company')
  return { ok: true }
}

// --- Self-booking publication gate (brief 0008 #988) ---------------------------

// The minimum required to publish the public self-booking page: at least one
// unit with both an address and business hours, one active+public service, and
// one approved professional. Server-side revalidation (AC-07) — never trust the
// UI checklist. Returns the list of missing items (empty = ready).
export type PublishingReadiness = {
  ready: boolean
  missing: string[]
}

export async function getPublishingReadiness(orgId: string): Promise<PublishingReadiness> {
  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(orgId)

  const [unitsSnap, servicesSnap, professionalsSnap] = await Promise.all([
    orgRef.collection('units').withConverter(fsConverter(StoredUnit)).get(),
    orgRef.collection('catalog_items').withConverter(fsConverter(CatalogItem)).get(),
    orgRef.collection('professionals').withConverter(fsConverter(StoredProfessional)).get(),
  ])

  const hasReadyUnit = unitsSnap.docs
    .map((d) => d.data())
    .some((u) => u.address !== null && u.businessHours !== null)
  // Publish gate (brief 0023, #1004): needs ≥1 public bookable kind-service item.
  const hasPublicService = servicesSnap.docs
    .map((d) => d.data())
    .filter(isCatalogService)
    .some((s) => s.active && s.publicVisible)
  const hasOperationalProfessional = professionalsSnap.docs
    .map((d) => d.data())
    .some((p) => p.operationalStatus === 'operational')

  const missing: string[] = []
  if (!hasReadyUnit) missing.push('1 unidade com endereço e horário de funcionamento')
  if (!hasPublicService) missing.push('1 serviço visível no catálogo público')
  if (!hasOperationalProfessional) missing.push('1 profissional operacional')

  return { ready: missing.length === 0, missing }
}

export type PublishResult = { ok: true } | { ok: false; error: string }

export async function publishSelfBooking(): Promise<PublishResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  // AC-07: server revalidates the minimum before publishing (defense in depth —
  // never trust the UI checklist).
  const readiness = await getPublishingReadiness(orgId)
  if (!readiness.ready) {
    return { ok: false, error: `Faltam requisitos: ${readiness.missing.join('; ')}` }
  }

  // Event-first: the publication state is a dedicated domain event; the reducer
  // projects selfBookingPublished. Auditoria = stream (actorId no evento) — sem
  // recordAudit.
  const published = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.self_booking_published',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!published.ok) return { ok: false, error: published.error }

  revalidatePath('/company')
  return { ok: true }
}

export async function unpublishSelfBooking(): Promise<PublishResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const unpublished = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.self_booking_unpublished',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!unpublished.ok) return { ok: false, error: unpublished.error }

  revalidatePath('/company')
  return { ok: true }
}
