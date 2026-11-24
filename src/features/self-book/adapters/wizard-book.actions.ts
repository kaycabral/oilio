'use server'

import {
  attributionFromParams,
  getTodayInOrgTz,
  isBookingLimitsUnrestricted,
  isCatalogService,
  isInstantWithinTimeScope,
  isOperational,
  isReservedSlug,
  isReservedUnitSlug,
  isUnitPubliclyLive,
  isValidSlug,
  isValidUnitSlug,
  resolveCatalogItemForUnit,
  unitCancellationPolicySnapshot,
  type Appointment,
  type BookingLimits,
  type CatalogItem,
  type MemberOperation,
  type StoredUnit,
} from '@/domain'
import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { checkBookingLimits } from '@/features/booking/adapters/check-booking-limits'
import { commitAppointmentBooking } from '@/features/booking/adapters/commit-appointment'
import { enforceSlotGrid } from '@/features/booking/adapters/enforce-slot-grid'
import { resolveCustomerSubscriptionScope } from '@/features/booking/adapters/subscription-scope.repo'
import { parseWizardFields, type WizardFields } from '@/features/self-book/core/wizard-fields'
import { getSessionUser } from '@/shared/auth/session'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'
import { formString } from '@/shared/form-data'
import { ensureSelfSignupCustomer } from '@/shared/org/customer-upsert'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { getUserDoc } from '@/shared/org/membership'
import { getOrgBySlug } from '@/shared/org/org'
import { listStoredUnitsForOrg } from '@/shared/org/unit-read'
import { channelOf, emitClientFunnelEvent } from '@/shared/product'

export type WizardBookingResult =
  | { ok: true; bookingId: string; orgId: string; unitSlug: string }
  | { ok: false; error: string }
  | {
      ok: false
      kind: 'reschedule-required'
      error: string
      existingAppointment: { id: string; startAt: string }
      rescheduleHref: string
    }
  | { ok: false; kind: 'out-of-scope'; error: string }
  | { ok: false; kind: 'needs-login' }
  | { ok: false; kind: 'needs-completion' }

async function resolveWizardEntities(
  orgId: string,
  fields: Pick<WizardFields, 'serviceId' | 'memberOperationId'>,
  unitSlug: string,
): Promise<{ unit: StoredUnit; service: CatalogItem; memberOperation: MemberOperation } | string> {
  const [units, service, memberOperation] = await Promise.all([
    listStoredUnitsForOrg(orgId),
    getCatalogItemById(orgId, fields.serviceId),
    getMemberOperationById(orgId, fields.memberOperationId),
  ])

  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return 'Unidade não encontrada.'

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

async function checkWizardSubscriptionScope(args: {
  org: { id: string; timezone: string }
  session: Awaited<ReturnType<typeof getSessionUser>>
  service: CatalogItem
  startAtDate: Date
}): Promise<{ bookingLimits: BookingLimits | null } | { error: WizardBookingResult }> {
  const { org, session, service, startAtDate } = args
  if (!session) return { bookingLimits: null }
  const scope = await resolveCustomerSubscriptionScope(org.id, session.uid)

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
  const { serviceId, memberOperationId, startAtDate } = fields

  const session = await getSessionUser()
  if (!session) return { ok: false, kind: 'needs-login' }
  const sessionUser = await getUserDoc(session.uid)
  if (!sessionUser || !sessionUser.completionCompleted) {
    return { ok: false, kind: 'needs-completion' }
  }

  const entities = await resolveWizardEntities(org.id, fields, unitSlug)
  if (typeof entities === 'string') return { ok: false, error: entities }
  const { unit, service } = entities

  if (!isUnitPubliclyLive(unit)) {
    return { ok: false, error: 'Estabelecimento indisponível.' }
  }
  const unitScope = { id: org.id, timezone: unit.timezone }

  const resolved = resolveCatalogItemForUnit(service, unit.id)
  const endAt = new Date(startAtDate.getTime() + resolved.durationMinutes * 60_000)

  const gridCheck = enforceSlotGrid({
    unit,
    startAt: startAtDate.toISOString(),
    durationMinutes: resolved.durationMinutes,
    surface: 'self_book',
    orgId: org.id,
    userId: session.uid,
  })
  if (!gridCheck.ok) return { ok: false, error: gridCheck.error }

  const scopeResult = await checkWizardSubscriptionScope({
    org: unitScope,
    session,
    service,
    startAtDate,
  })
  if ('error' in scopeResult) return scopeResult.error
  const bookingLimitsForCustomer = scopeResult.bookingLimits

  const attribution = attributionFromParams((k) => formString(formData, k) || null)

  const customer = await ensureSelfSignupCustomer(org.id, session.uid, attribution)
  const customerId = customer.customerId

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
    cancellationPolicySnapshot: unitCancellationPolicySnapshot(unit.agenda),
    customerUserId: userIds.ids.customerUserId,
    memberOperatorUserId: userIds.ids.memberOperatorUserId,
    attribution,
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
    return {
      ok: false,
      error: 'Esse horário não está mais disponível. Volte e escolha outro.',
    }
  }

  await emitClientFunnelEvent({
    event: 'appointment_created',
    orgId: org.id,
    customerId,
    ...channelOf(attribution),
  })

  return { ok: true, bookingId, orgId: org.id, unitSlug: unit.slug }
}
