'use server'

import {
  type Appointment,
  CatalogItem,
  StoredProfessional,
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
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { formString } from '@/shared/form-data'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { getOrgBySlug } from '@/shared/org/org'

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
// Resolve + validate the booked service and professional for the legacy public
// flow: service must be a public active kind-service; professional must belong to
// the org with at least one unit (the booking lands on their first unit).
async function resolvePublicBookingEntities(
  orgRef: FirebaseFirestore.DocumentReference,
  serviceId: string,
  professionalId: string,
): Promise<{ service: CatalogItem; unitId: string } | string> {
  const serviceSnap = await orgRef
    .collection('catalog_items')
    .withConverter(fsConverter(CatalogItem))
    .doc(serviceId)
    .get()
  const service = serviceSnap.data()
  if (!service) return 'Serviço não encontrado.'
  if (!isCatalogService(service)) return 'Item não é um serviço.'
  if (!service.active || !service.publicVisible) {
    return 'Serviço não está disponível para agendamento público.'
  }

  const proSnap = await orgRef
    .collection('professionals')
    .withConverter(fsConverter(StoredProfessional))
    .doc(professionalId)
    .get()
  const professional = proSnap.data()
  if (!professional) return 'Profissional não encontrado.'
  if (professional.unitIds.length === 0) return 'Profissional sem unidade vinculada.'
  return { service, unitId: professional.unitIds[0]! }
}

export async function createPublicBooking(formData: FormData): Promise<PublicBookingResult> {
  const slug = formString(formData, 'slug').trim()
  if (!isValidSlug(slug) || isReservedSlug(slug)) {
    return { ok: false, error: 'Página inválida.' }
  }

  const org = await getOrgBySlug(slug)
  if (!org || !org.selfBookingPublished) {
    return { ok: false, error: 'Estabelecimento indisponível.' }
  }

  const serviceId = formString(formData, 'serviceId').trim()
  const professionalId = formString(formData, 'professionalId').trim()
  const startAtLocal = formString(formData, 'startAt').trim()
  const customerName = formString(formData, 'customerName').trim()
  const customerWhatsappRaw = formString(formData, 'customerWhatsapp').trim()
  const customerEmailRaw = formString(formData, 'customerEmail').trim()

  if (serviceId.length === 0) return { ok: false, error: 'Selecione um serviço.' }
  if (professionalId.length === 0) return { ok: false, error: 'Selecione um profissional.' }
  if (startAtLocal.length === 0) return { ok: false, error: 'Selecione data e horário.' }
  if (customerName.length < 2) return { ok: false, error: 'Informe seu nome completo.' }

  const whatsapp = normalizeBrazilPhone(customerWhatsappRaw)
  if (!whatsapp) return { ok: false, error: 'Número de WhatsApp inválido.' }

  // Parse datetime-local como hora-local-do-org. O <input type="datetime-local">
  // envia "yyyy-MM-ddTHH:mm" sem timezone — interpretar como UTC seria errado;
  // tratamos esses dígitos como horário do org e convertemos pra UTC.
  // Usamos Intl.DateTimeFormat para resolver o offset do dia escolhido (DST).
  let startAtUtc: Date
  try {
    startAtUtc = parseOrgLocalAsUtc(startAtLocal, org.timezone)
  } catch {
    return { ok: false, error: 'Data/horário inválidos.' }
  }
  if (startAtUtc.getTime() <= Date.now()) {
    return { ok: false, error: 'Escolha um horário no futuro.' }
  }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(org.id)

  const entities = await resolvePublicBookingEntities(orgRef, serviceId, professionalId)
  if (typeof entities === 'string') return { ok: false, error: entities }
  const { service, unitId } = entities

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

  const userIds = await resolveAppointmentUserIds(org.id, customerId, professionalId)
  if (!userIds.ok) return userIds

  const aptRef = orgRef.collection('appointments').doc()
  const appointment: Appointment = {
    id: aptRef.id,
    orgId: org.id,
    unitId,
    professionalId,
    customerId,
    serviceId,
    startAt: startAtUtc.toISOString(),
    endAt: endAtUtc.toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: resolved.priceCents,
    serviceDurationMinutesSnapshot: resolved.durationMinutes,
    commissionSnapshot: resolved.commission,
    // Snapshot da cancellation policy no commit (#1038).
    cancellationPolicySnapshot: normalizeCancellationPolicy(org.cancellationPolicy),
    customerUserId: userIds.ids.customerUserId,
    professionalUserId: userIds.ids.professionalUserId,
    createdAt: now,
    updatedAt: now,
  }

  // Transactional anti-double-book (#843). The check + write happen atomically
  // — concurrent writers are serialized by Firestore's PCC, and a detected
  // conflict logs `appointment.double_book_blocked` within the same tx.
  const commit = await commitAppointmentBooking({
    db,
    orgRef,
    appointment,
    actorUid: `public:${customerId}`,
    via: 'public_landing',
  })
  if (!commit.ok) {
    return { ok: false, error: 'Esse horário já está ocupado. Escolha outro.' }
  }

  // Auditoria = stream: `commitAppointmentBooking` já emite `appointment.created`
  // (fonte de verdade). Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true, bookingId: aptRef.id, orgId: org.id }
}
