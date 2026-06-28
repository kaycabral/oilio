'use server'

import {
  getTodayInOrgTz,
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
  type CatalogItem,
  type MemberOperation,
  type StoredUnit,
} from '@/domain'
import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { checkBookingLimits } from '@/features/booking/adapters/check-booking-limits'
import { commitAppointmentBooking } from '@/features/booking/adapters/commit-appointment'
import { resolveCustomerSubscriptionScope } from '@/features/booking/adapters/subscription-scope.repo'
import { isValidEmail } from '@/features/self-book/core/contact'
import { parseWizardFields, type WizardFields } from '@/features/self-book/core/wizard-fields'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { getOrgBySlug } from '@/shared/org/org'
import { listStoredUnitsForOrg } from '@/shared/org/unit-read'

// Server action for the unit-scoped wizard (#844). Differs from the legacy
// `createPublicBooking` (which lives at `/{slug}/book` and accepts free-form
// datetime input) in three ways:
//   - `unitSlug` comes from the path, not the form.
//   - `startAt` comes pre-resolved as an ISO UTC instant (from the availability
//     calendar click) — no parsing of `datetime-local`.
//   - `memberOperationId` is required (the calendar in #842 always assigns a pro).

export type WizardBookingResult =
  | { ok: true; bookingId: string; orgId: string; unitSlug: string }
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

// Resolve the unit / service / memberOperation and validate they form a bookable
// combination in this unit (public visibility, links, approval). Error or trio.
async function resolveWizardEntities(
  orgId: string,
  fields: Pick<WizardFields, 'serviceId' | 'memberOperationId'>,
  unitSlug: string,
): Promise<{ unit: StoredUnit; service: CatalogItem; memberOperation: MemberOperation } | string> {
  // Typed projection reads under RLS (Postgres cutover, #1202): units list +
  // catalog item + memberOperation. The three are independent — run in parallel.
  const [units, service, memberOperation] = await Promise.all([
    listStoredUnitsForOrg(orgId),
    getCatalogItemById(orgId, fields.serviceId),
    getMemberOperationById(orgId, fields.memberOperationId),
  ])

  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return 'Unidade não encontrada.'

  // Unified catalog read (brief 0023, #1004): kind service + public visibility.
  if (!service) return 'Serviço não encontrado.'
  if (!isCatalogService(service)) return 'Item não é um serviço.'
  if (!service.active || !service.publicVisible) return 'Serviço indisponível.'
  if (!Array.isArray(service.unitIds) || !service.unitIds.includes(unit.id)) {
    return 'Serviço não oferecido nesta unidade.'
  }

  if (!memberOperation) return 'Profissional não encontrado.'
  if (!memberOperation.unitIds.includes(unit.id)) return 'Profissional não atende nesta unidade.'
  if (
    !Array.isArray(memberOperation.catalogServiceIds) ||
    !memberOperation.catalogServiceIds.includes(service.id)
  ) {
    return 'Profissional não executa este serviço.'
  }
  if (!isOperational(memberOperation.operationalStatus)) return 'Profissional indisponível.'

  return { unit, service, memberOperation }
}

// Defense-in-depth (brief 0019): re-check the signed-in visitor's subscription
// scope server-side (category coverage + temporal window), even though the
// availability UI filtered slots. Avulso (no session) skips. Returns the plan's
// booking limits to enforce, or an out-of-scope `WizardBookingResult`.
async function checkWizardSubscriptionScope(args: {
  org: { id: string; timezone: string }
  session: Awaited<ReturnType<typeof getSessionUser>>
  service: CatalogItem
  startAtDate: Date
}): Promise<{ bookingLimits: BookingLimits | null } | { error: WizardBookingResult }> {
  const { org, session, service, startAtDate } = args
  if (!session) return { bookingLimits: null }
  const scope = await resolveCustomerSubscriptionScope(org.id, session.uid)

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
    const todayInTz = getTodayInOrgTz(org.timezone)
    const inScope = isInstantWithinTimeScope(
      scope.allowedTimeScope,
      startAtDate.toISOString(),
      org.timezone,
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
  org: { id: string; timezone: string }
  customerId: string
  startAtDate: Date
  session: Awaited<ReturnType<typeof getSessionUser>>
  bookingLimits: BookingLimits | null
}): Promise<WizardBookingResult | null> {
  const { session, bookingLimits } = args
  if (!session || !bookingLimits || isBookingLimitsUnrestricted(bookingLimits)) return null
  const limitCheck = await checkBookingLimits({
    orgId: args.org.id,
    orgTimezone: args.org.timezone,
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

  const org = await getOrgBySlug(slug)
  if (!org) return { ok: false, error: 'Estabelecimento indisponível.' }

  const fields = parseWizardFields(formData)
  if (typeof fields === 'string') return { ok: false, error: fields }
  const { serviceId, memberOperationId, startAtDate, customerName, whatsapp, customerEmailRaw } =
    fields

  const entities = await resolveWizardEntities(org.id, fields, unitSlug)
  if (typeof entities === 'string') return { ok: false, error: entities }
  const { unit, service } = entities

  // Publish gate, timezone and cancellation policy are the establishment's now
  // (PRD Identidade v2 — moved Org→Unit): gate on the unit's appointment-agenda
  // publish state and use the unit's tz for all temporal logic below.
  if (unit.agenda.mode !== 'appointment' || !unit.agenda.selfBookingPublished) {
    return { ok: false, error: 'Estabelecimento indisponível.' }
  }
  const unitScope = { id: org.id, timezone: unit.timezone }

  const resolved = resolveCatalogItemForUnit(service, unit.id)
  const endAt = new Date(startAtDate.getTime() + resolved.durationMinutes * 60_000)

  const session = await getSessionUser()
  // Behavioral scope (brief 0019, Group C — AC-12..14) reuses the same resolver;
  // hoist the booking limits to enforce below once the customer is materialized.
  const scopeResult = await checkWizardSubscriptionScope({
    org: unitScope,
    session,
    service,
    startAtDate,
  })
  if ('error' in scopeResult) return scopeResult.error
  const bookingLimitsForCustomer = scopeResult.bookingLimits

  const upsert = await upsertCustomerWithUser({
    orgId: org.id,
    name: customerName,
    whatsappRaw: whatsapp,
    email: isValidEmail(customerEmailRaw) ? customerEmailRaw : null,
    birthDate: null,
  })
  if (!upsert.ok) return upsert
  const customerId = upsert.customerId

  const limitsErr = await enforceWizardBookingLimits({
    org: unitScope,
    customerId,
    startAtDate,
    session,
    bookingLimits: bookingLimitsForCustomer,
  })
  if (limitsErr) return limitsErr

  const now = new Date().toISOString()
  const userIds = await resolveAppointmentUserIds(org.id, customerId, memberOperationId)
  if (!userIds.ok) return userIds

  const bookingId = newId()
  const appointment: Appointment = {
    id: bookingId,
    orgId: org.id,
    unitId: unit.id,
    memberOperationId,
    customerId,
    serviceId,
    startAt: startAtDate.toISOString(),
    endAt: endAt.toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: resolved.priceCents,
    serviceDurationMinutesSnapshot: resolved.durationMinutes,
    commissionSnapshot: resolved.commission,
    // Snapshot da cancellation policy no commit (#1038).
    cancellationPolicySnapshot: normalizeCancellationPolicy(unit.agenda.cancellationPolicy),
    customerUserId: userIds.ids.customerUserId,
    memberOperatorUserId: userIds.ids.memberOperatorUserId,
    createdAt: now,
    updatedAt: now,
  }

  const commit = await commitAppointmentBooking({
    orgId: org.id,
    appointment,
    actorUid: `public:${customerId}`,
    via: 'self_book_wizard',
  })
  if (!commit.ok) {
    return { ok: false, error: 'Esse horário acabou de ser ocupado. Volte e escolha outro.' }
  }

  // Auditoria = stream: `commitAppointmentBooking` já emite `appointment.created`
  // (fonte de verdade). Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true, bookingId, orgId: org.id, unitSlug: unit.slug }
}
