'use server'

import {
  CatalogItem,
  StoredProfessional,
  StoredUnit,
  getTodayInTenantTz,
  isBookingLimitsUnrestricted,
  isCatalogService,
  isInstantWithinTimeScope,
  isOperational,
  isReservedSlug,
  isReservedUnitSlug,
  isValidSlug,
  isValidUnitSlug,
  normalizeCancellationPolicy,
  resolveCatalogItemForUnit,
  type Appointment,
  type BookingLimits,
} from '@/domain'
import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { checkBookingLimits } from '@/features/booking/adapters/check-booking-limits'
import { commitAppointmentBooking } from '@/features/booking/adapters/commit-appointment'
import { resolveCustomerSubscriptionScope } from '@/features/booking/adapters/subscription-scope.repo'
import { isValidEmail } from '@/features/self-book/core/contact'
import { parseWizardFields, type WizardFields } from '@/features/self-book/core/wizard-fields'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { upsertCustomerWithUser } from '@/shared/tenant/customer-upsert'
import { getTenantBySlug } from '@/shared/tenant/tenant'

// Server action for the unit-scoped wizard (#844). Differs from the legacy
// `createPublicBooking` (which lives at `/{slug}/book` and accepts free-form
// datetime input) in three ways:
//   - `unitSlug` comes from the path, not the form.
//   - `startAt` comes pre-resolved as an ISO UTC instant (from the availability
//     calendar click) — no parsing of `datetime-local`.
//   - `professionalId` is required (the calendar in #842 always assigns a pro).

export type WizardBookingResult =
  | { ok: true; bookingId: string; tenantId: string; unitSlug: string }
  | { ok: false; error: string }
  // Brief 0019 Group C — AC-12. Surfaces a special signal when the
  // customer already has the maximum same-day appointments allowed by
  // their plan. The client opens a "trocar horário" modal pointing at
  // the existing appointment instead of creating a duplicate.
  | {
      ok: false
      kind: 'reschedule-required'
      error: string
      existingAppointment: { id: string; startAt: string }
      rescheduleHref: string
    }
  // Brief 0019 Group D — AC-17. Defense-in-depth rejected the booking
  // because the slot falls outside the customer's subscription scope
  // (temporal axis). The client trades the generic error for a friendly
  // message with a "Falar no WhatsApp" CTA pointing at the unit.
  | { ok: false; kind: 'out-of-scope'; error: string }

// Resolve the unit / service / professional and validate they form a bookable
// combination in this unit (public visibility, links, approval). Error or trio.
async function resolveWizardEntities(
  tenantRef: FirebaseFirestore.DocumentReference,
  fields: Pick<WizardFields, 'serviceId' | 'professionalId'>,
  unitSlug: string,
): Promise<{ unit: StoredUnit; service: CatalogItem; professional: StoredProfessional } | string> {
  const [unitsSnap, serviceSnap, proSnap] = await Promise.all([
    tenantRef.collection('units').withConverter(fsConverter(StoredUnit)).get(),
    tenantRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .doc(fields.serviceId)
      .get(),
    tenantRef
      .collection('professionals')
      .withConverter(fsConverter(StoredProfessional))
      .doc(fields.professionalId)
      .get(),
  ])

  const unit = unitsSnap.docs.map((d) => d.data()).find((u) => u.slug === unitSlug)
  if (!unit) return 'Unidade não encontrada.'

  // Unified catalog read (brief 0023, #1004): kind service + public visibility.
  const service = serviceSnap.data()
  if (!service) return 'Serviço não encontrado.'
  if (!isCatalogService(service)) return 'Item não é um serviço.'
  if (!service.active || !service.publicVisible) return 'Serviço indisponível.'
  if (!Array.isArray(service.unitIds) || !service.unitIds.includes(unit.id)) {
    return 'Serviço não oferecido nesta unidade.'
  }

  const professional = proSnap.data()
  if (!professional) return 'Profissional não encontrado.'
  if (!professional.unitIds.includes(unit.id)) return 'Profissional não atende nesta unidade.'
  if (!Array.isArray(professional.serviceIds) || !professional.serviceIds.includes(service.id)) {
    return 'Profissional não executa este serviço.'
  }
  if (!isOperational(professional.operationalStatus)) return 'Profissional indisponível.'

  return { unit, service, professional }
}

// Defense-in-depth (brief 0019): re-check the signed-in visitor's subscription
// scope server-side (category coverage + temporal window), even though the
// availability UI filtered slots. Avulso (no session) skips. Returns the plan's
// booking limits to enforce, or an out-of-scope `WizardBookingResult`.
async function checkWizardSubscriptionScope(args: {
  tenant: { id: string; timezone: string }
  session: Awaited<ReturnType<typeof getSessionUser>>
  service: CatalogItem
  startAtDate: Date
}): Promise<{ bookingLimits: BookingLimits | null } | { error: WizardBookingResult }> {
  const { tenant, session, service, startAtDate } = args
  if (!session) return { bookingLimits: null }
  const scope = await resolveCustomerSubscriptionScope(tenant.id, session.uid)

  // Category coverage (brief 0023, AC-06).
  if (scope.includedCategoryIds) {
    const covered = service.categoryId !== null && scope.includedCategoryIds.has(service.categoryId)
    if (!covered) {
      return {
        error: {
          ok: false,
          kind: 'out-of-scope',
          error:
            'Esse serviço está fora das categorias do seu plano. Fale com a unidade pra combinar essa exceção.',
        },
      }
    }
  }
  if (scope.allowedTimeScope) {
    const todayInTz = getTodayInTenantTz(tenant.timezone)
    const inScope = isInstantWithinTimeScope(
      scope.allowedTimeScope,
      startAtDate.toISOString(),
      tenant.timezone,
      todayInTz,
    )
    if (!inScope) {
      return {
        error: {
          ok: false,
          kind: 'out-of-scope',
          error:
            'Esse horário está fora da janela do seu plano. Fale com a unidade pra combinar essa exceção.',
        },
      }
    }
  }
  return { bookingLimits: scope.bookingLimits }
}

// Behavioral scope enforcement (brief 0019, Group C — AC-12..14). Avulso (no
// session / no subscription) skips. Returns a reschedule-required/blocked
// `WizardBookingResult`, or null when the booking may proceed.
async function enforceWizardBookingLimits(args: {
  db: ReturnType<typeof getAdminFirestore>
  tenant: { id: string; timezone: string }
  customerId: string
  startAtDate: Date
  session: Awaited<ReturnType<typeof getSessionUser>>
  bookingLimits: BookingLimits | null
}): Promise<WizardBookingResult | null> {
  const { session, bookingLimits } = args
  if (!session || !bookingLimits || isBookingLimitsUnrestricted(bookingLimits)) return null
  const limitCheck = await checkBookingLimits({
    db: args.db,
    tenantId: args.tenant.id,
    tenantTimezone: args.tenant.timezone,
    customerId: args.customerId,
    limits: bookingLimits,
    proposedStartAt: args.startAtDate.toISOString(),
  })
  if (limitCheck.kind === 'reschedule-required') {
    return {
      ok: false,
      kind: 'reschedule-required',
      error: 'Você já tem um agendamento neste dia. Reagende-o em vez de criar um novo.',
      existingAppointment: limitCheck.existingAppointment,
      // Self-service customer routes (brief 0003 #651) host the per-appointment
      // reschedule flow — point the modal there.
      rescheduleHref: `/me/appointments`,
    }
  }
  if (limitCheck.kind === 'blocked') return { ok: false, error: limitCheck.message }
  return null
}

export async function createWizardBooking(formData: FormData): Promise<WizardBookingResult> {
  const slug = formString(formData, 'slug').trim()
  const unitSlug = formString(formData, 'unitSlug').trim()
  if (!isValidSlug(slug) || isReservedSlug(slug)) {
    return { ok: false, error: 'Página inválida.' }
  }
  if (!isValidUnitSlug(unitSlug) || isReservedUnitSlug(unitSlug)) {
    return { ok: false, error: 'Unidade inválida.' }
  }

  const tenant = await getTenantBySlug(slug)
  if (!tenant || !tenant.selfBookingPublished) {
    return { ok: false, error: 'Estabelecimento indisponível.' }
  }

  const fields = parseWizardFields(formData)
  if (typeof fields === 'string') return { ok: false, error: fields }
  const { serviceId, professionalId, startAtDate, customerName, whatsapp, customerEmailRaw } =
    fields

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenant.id)

  const entities = await resolveWizardEntities(tenantRef, fields, unitSlug)
  if (typeof entities === 'string') return { ok: false, error: entities }
  const { unit, service } = entities

  const resolved = resolveCatalogItemForUnit(service, unit.id)
  const endAt = new Date(startAtDate.getTime() + resolved.durationMinutes * 60_000)

  const session = await getSessionUser()
  // Behavioral scope (brief 0019, Group C — AC-12..14) reuses the same resolver;
  // hoist the booking limits to enforce below once the customer is materialized.
  const scopeResult = await checkWizardSubscriptionScope({ tenant, session, service, startAtDate })
  if ('error' in scopeResult) return scopeResult.error
  const bookingLimitsForCustomer = scopeResult.bookingLimits

  const upsert = await upsertCustomerWithUser({
    tenantId: tenant.id,
    name: customerName,
    whatsappRaw: whatsapp,
    email: isValidEmail(customerEmailRaw) ? customerEmailRaw : null,
    birthDate: null,
  })
  if (!upsert.ok) return upsert
  const customerId = upsert.customerId

  const limitsErr = await enforceWizardBookingLimits({
    db,
    tenant,
    customerId,
    startAtDate,
    session,
    bookingLimits: bookingLimitsForCustomer,
  })
  if (limitsErr) return limitsErr

  const now = new Date().toISOString()
  const userIds = await resolveAppointmentUserIds(tenant.id, customerId, professionalId)
  if (!userIds.ok) return userIds

  const aptRef = tenantRef.collection('appointments').doc()
  const appointment: Appointment = {
    id: aptRef.id,
    tenantId: tenant.id,
    unitId: unit.id,
    professionalId,
    customerId,
    serviceId,
    startAt: startAtDate.toISOString(),
    endAt: endAt.toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: resolved.priceCents,
    serviceDurationMinutesSnapshot: resolved.durationMinutes,
    commissionSnapshot: resolved.commission,
    // Snapshot da cancellation policy no commit (#1038).
    cancellationPolicySnapshot: normalizeCancellationPolicy(tenant.cancellationPolicy),
    customerUserId: userIds.ids.customerUserId,
    professionalUserId: userIds.ids.professionalUserId,
    createdAt: now,
    updatedAt: now,
  }

  const commit = await commitAppointmentBooking({
    db,
    tenantRef,
    appointment,
    actorUid: `public:${customerId}`,
    via: 'self_book_wizard',
  })
  if (!commit.ok) {
    return { ok: false, error: 'Esse horário acabou de ser ocupado. Volte e escolha outro.' }
  }

  // Auditoria = stream: `commitAppointmentBooking` já emite `appointment.created`
  // (fonte de verdade). Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true, bookingId: aptRef.id, tenantId: tenant.id, unitSlug: unit.slug }
}
