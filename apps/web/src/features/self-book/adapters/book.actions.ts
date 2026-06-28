'use server'

import {
  type Appointment,
  type CatalogItem,
  isCatalogService,
  isReservedSlug,
  isValidSlug,
  normalizeBrazilPhone,
  normalizeCancellationPolicy,
  resolveCatalogItemForUnit,
} from '@/domain'
import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { commitAppointmentBooking } from '@/features/booking/adapters/commit-appointment'
import { isValidEmail } from '@/features/self-book/core/contact'
import { parseOrgLocalAsUtc } from '@/features/self-book/core/datetime'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'
import { formString } from '@/shared/form-data'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { getOrgBySlug } from '@/shared/org/org'
import { getUnitById } from '@/shared/org/unit-read'

export type PublicBookingResult =
  | { ok: true; bookingId: string; orgId: string }
  | { ok: false; error: string }

// Booking público anônimo — chamado pelo formulário em /[slug]/book sem
// sessão autenticada. Carve-outs:
//   - Sem OTP/email validation: ainda não temos provider de email/SMS no
//     monorepo (rastreado em #796). Customer auto-criado fica como contato
//     simples; em caso de no-show recorrente o owner cancela manualmente.
//   - Status do appointment é 'scheduled' direto (não há 'pending' hoje).
//     Owner vê na agenda imediatamente e pode cancelar.
//   - Idempotência por whatsapp normalizado: se já existe customer com mesmo
//     telefone no org, reusa o doc. Nome novo NÃO sobrescreve o antigo —
//     evita squat de identidade.
// Resolve + validate the booked service and memberOperation for the legacy public
// flow: service must be a public active kind-service; memberOperation must belong to
// the org with at least one unit (the booking lands on their first unit).
async function resolvePublicBookingEntities(
  orgId: string,
  serviceId: string,
  memberOperationId: string,
): Promise<{ service: CatalogItem; unitId: string } | string> {
  const service = await getCatalogItemById(orgId, serviceId)
  if (!service) return 'Serviço não encontrado.'
  if (!isCatalogService(service)) return 'Item não é um serviço.'
  if (!service.active || !service.publicVisible) {
    return 'Serviço não está disponível para agendamento público.'
  }

  const memberOperation = await getMemberOperationById(orgId, memberOperationId)
  if (!memberOperation) return 'Profissional não encontrado.'
  if (memberOperation.unitIds.length === 0) return 'Profissional sem unidade vinculada.'
  return { service, unitId: memberOperation.unitIds[0]! }
}

export async function createPublicBooking(formData: FormData): Promise<PublicBookingResult> {
  const slug = formString(formData, 'slug').trim()
  if (!isValidSlug(slug) || isReservedSlug(slug)) {
    return { ok: false, error: 'Página inválida.' }
  }

  const org = await getOrgBySlug(slug)
  if (!org) return { ok: false, error: 'Estabelecimento indisponível.' }

  const serviceId = formString(formData, 'serviceId').trim()
  const memberOperationId = formString(formData, 'memberOperationId').trim()
  const startAtLocal = formString(formData, 'startAt').trim()
  const customerName = formString(formData, 'customerName').trim()
  const customerWhatsappRaw = formString(formData, 'customerWhatsapp').trim()
  const customerEmailRaw = formString(formData, 'customerEmail').trim()

  if (serviceId.length === 0) return { ok: false, error: 'Selecione um serviço.' }
  if (memberOperationId.length === 0) return { ok: false, error: 'Selecione um profissional.' }
  if (startAtLocal.length === 0) return { ok: false, error: 'Selecione data e horário.' }
  if (customerName.length < 2) return { ok: false, error: 'Informe seu nome completo.' }

  const whatsapp = normalizeBrazilPhone(customerWhatsappRaw)
  if (!whatsapp) return { ok: false, error: 'Número de WhatsApp inválido.' }

  const entities = await resolvePublicBookingEntities(org.id, serviceId, memberOperationId)
  if (typeof entities === 'string') return { ok: false, error: entities }
  const { service, unitId } = entities

  // Timezone, the publish gate, and the cancellation policy are the
  // establishment's now (PRD Identidade v2 — moved Org→Unit). Resolve the unit
  // the booking lands on and gate on its appointment-agenda publish state.
  const unit = await getUnitById(org.id, unitId)
  if (!unit || unit.agenda.mode !== 'appointment' || !unit.agenda.selfBookingPublished) {
    return { ok: false, error: 'Estabelecimento indisponível.' }
  }

  // Parse datetime-local como hora-local-da-unidade. O <input
  // type="datetime-local"> envia "yyyy-MM-ddTHH:mm" sem timezone — interpretar
  // como UTC seria errado; tratamos esses dígitos como horário da unidade e
  // convertemos pra UTC. Intl.DateTimeFormat resolve o offset do dia (DST).
  let startAtUtc: Date
  try {
    startAtUtc = parseOrgLocalAsUtc(startAtLocal, unit.timezone)
  } catch {
    return { ok: false, error: 'Data/horário inválidos.' }
  }
  if (startAtUtc.getTime() <= Date.now()) {
    return { ok: false, error: 'Escolha um horário no futuro.' }
  }

  const resolved = resolveCatalogItemForUnit(service, unitId)
  const endAtUtc = new Date(startAtUtc.getTime() + resolved.durationMinutes * 60_000)

  // Customer + User stub via shared upsert. Idempotency lives at the User
  // level (whatsapp is the canonical channel) so the same human re-booking
  // in any org reuses one User doc — see #832. Done BEFORE the booking
  // tx so retries on slot contention don't re-upsert the customer.
  const upsert = await upsertCustomerWithUser({
    orgId: org.id,
    name: customerName,
    whatsappRaw: whatsapp,
    email: isValidEmail(customerEmailRaw) ? customerEmailRaw : null,
    birthDate: null,
  })
  if (!upsert.ok) return upsert
  const customerId = upsert.customerId
  const now = new Date().toISOString()

  const userIds = await resolveAppointmentUserIds(org.id, customerId, memberOperationId)
  if (!userIds.ok) return userIds

  const bookingId = newId()
  const appointment: Appointment = {
    id: bookingId,
    orgId: org.id,
    unitId,
    memberOperationId,
    customerId,
    serviceId,
    startAt: startAtUtc.toISOString(),
    endAt: endAtUtc.toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: resolved.priceCents,
    serviceDurationMinutesSnapshot: resolved.durationMinutes,
    commissionSnapshot: resolved.commission,
    // Snapshot da cancellation policy no commit (#1038) — da agenda da unidade.
    cancellationPolicySnapshot: normalizeCancellationPolicy(unit.agenda.cancellationPolicy),
    customerUserId: userIds.ids.customerUserId,
    memberOperatorUserId: userIds.ids.memberOperatorUserId,
    createdAt: now,
    updatedAt: now,
  }

  // Transactional anti-double-book (#843). The check + write happen atomically
  // — concurrent writers are serialized by Firestore's PCC, and a detected
  // conflict logs `appointment.double_book_blocked` within the same tx.
  const commit = await commitAppointmentBooking({
    orgId: org.id,
    appointment,
    actorUid: `public:${customerId}`,
    via: 'public_landing',
  })
  if (!commit.ok) {
    return { ok: false, error: 'Esse horário já está ocupado. Escolha outro.' }
  }

  // Auditoria = stream: `commitAppointmentBooking` já emite `appointment.created`
  // (fonte de verdade). Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true, bookingId, orgId: org.id }
}
