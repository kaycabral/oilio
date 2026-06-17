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
import { parseTenantLocalAsUtc } from '@/features/self-book/core/datetime'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { formString } from '@/shared/form-data'
import { upsertCustomerWithUser } from '@/shared/tenant/customer-upsert'
import { getTenantBySlug } from '@/shared/tenant/tenant'

export type PublicBookingResult =
  | { ok: true; bookingId: string; tenantId: string }
  | { ok: false; error: string }

// Booking público anônimo — chamado pelo formulário em /[slug]/book sem
// sessão autenticada. Carve-outs:
//   - Sem OTP/email validation: ainda não temos provider de email/SMS no
//     monorepo (rastreado em #796). Customer auto-criado fica como contato
//     simples; em caso de no-show recorrente o owner cancela manualmente.
//   - Status do appointment é 'scheduled' direto (não há 'pending' hoje).
//     Owner vê na agenda imediatamente e pode cancelar.
//   - Idempotência por whatsapp normalizado: se já existe customer com mesmo
//     telefone no tenant, reusa o doc. Nome novo NÃO sobrescreve o antigo —
//     evita squat de identidade.
// Resolve + validate the booked service and professional for the legacy public
// flow: service must be a public active kind-service; professional must belong to
// the tenant with at least one unit (the booking lands on their first unit).
async function resolvePublicBookingEntities(
  tenantRef: FirebaseFirestore.DocumentReference,
  serviceId: string,
  professionalId: string,
): Promise<{ service: CatalogItem; unitId: string } | string> {
  const serviceSnap = await tenantRef
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

  const proSnap = await tenantRef
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

  const tenant = await getTenantBySlug(slug)
  if (!tenant || !tenant.selfBookingPublished) {
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

  // Parse datetime-local como hora-local-do-tenant. O <input type="datetime-local">
  // envia "yyyy-MM-ddTHH:mm" sem timezone — interpretar como UTC seria errado;
  // tratamos esses dígitos como horário do tenant e convertemos pra UTC.
  // Usamos Intl.DateTimeFormat para resolver o offset do dia escolhido (DST).
  let startAtUtc: Date
  try {
    startAtUtc = parseTenantLocalAsUtc(startAtLocal, tenant.timezone)
  } catch {
    return { ok: false, error: 'Data/horário inválidos.' }
  }
  if (startAtUtc.getTime() <= Date.now()) {
    return { ok: false, error: 'Escolha um horário no futuro.' }
  }

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenant.id)

  const entities = await resolvePublicBookingEntities(tenantRef, serviceId, professionalId)
  if (typeof entities === 'string') return { ok: false, error: entities }
  const { service, unitId } = entities

  const resolved = resolveCatalogItemForUnit(service, unitId)
  const endAtUtc = new Date(startAtUtc.getTime() + resolved.durationMinutes * 60_000)

  // Customer + User stub via shared upsert. Idempotency lives at the User
  // level (whatsapp is the canonical channel) so the same human re-booking
  // in any tenant reuses one User doc — see #832. Done BEFORE the booking
  // tx so retries on slot contention don't re-upsert the customer.
  const upsert = await upsertCustomerWithUser({
    tenantId: tenant.id,
    name: customerName,
    whatsappRaw: whatsapp,
    email: isValidEmail(customerEmailRaw) ? customerEmailRaw : null,
    birthDate: null,
  })
  if (!upsert.ok) return upsert
  const customerId = upsert.customerId
  const now = new Date().toISOString()

  const userIds = await resolveAppointmentUserIds(tenant.id, customerId, professionalId)
  if (!userIds.ok) return userIds

  const aptRef = tenantRef.collection('appointments').doc()
  const appointment: Appointment = {
    id: aptRef.id,
    tenantId: tenant.id,
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
    cancellationPolicySnapshot: normalizeCancellationPolicy(tenant.cancellationPolicy),
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
    tenantRef,
    appointment,
    actorUid: `public:${customerId}`,
    via: 'public_landing',
  })
  if (!commit.ok) {
    return { ok: false, error: 'Esse horário já está ocupado. Escolha outro.' }
  }

  // Auditoria = stream: `commitAppointmentBooking` já emite `appointment.created`
  // (fonte de verdade). Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true, bookingId: aptRef.id, tenantId: tenant.id }
}
