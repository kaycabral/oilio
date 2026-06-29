'use server'

import {
  type Appointment,
  type CatalogItem,
  attributionFromParams,
  isCatalogService,
  isReservedSlug,
  isValidSlug,
  normalizeCancellationPolicy,
  resolveCatalogItemForUnit,
} from '@/domain'
import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { commitAppointmentBooking } from '@/features/booking/adapters/commit-appointment'
import { parseOrgLocalAsUtc } from '@/features/self-book/core/datetime'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { ensureSelfSignupCustomer } from '@/shared/org/customer-upsert'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { getUserDoc } from '@/shared/org/membership'
import { getOrgBySlug } from '@/shared/org/org'
import { getUnitById } from '@/shared/org/unit-read'
import { channelOf, emitClientFunnelEvent } from '@/shared/product'

export type PublicBookingResult =
  | { ok: true; bookingId: string; orgId: string }
  | { ok: false; error: string }
  // Brief 0077 Grupo A — AC-01/AC-03 (#1275). Nobody agenda sem login: the
  // legacy public flow now refuses an unauthenticated booking too. The client
  // sends the visitor to Google login, returning to this booking URL.
  | { ok: false; kind: 'needs-login' }
  // Brief 0077 Grupo A — AC-03/AC-04 (#1274/#1275). Logged in but the profile
  // isn't complete (no whatsapp/birthDate) — the DB CHECK + this gate both
  // refuse. PII comes from the completed profile, never the form.
  | { ok: false; kind: 'needs-completion' }

// Booking público — chamado pelo formulário em /[slug]/book. Desde o brief 0077
// (#1275) exige login + cadastro completo: nenhum agendamento sem login, e o
// Customer é DERIVADO do uid autenticado (o form não carrega Nome/WhatsApp/email
// — a PII vem do perfil completo). Carve-outs remanescentes:
//   - Status do appointment é 'scheduled' direto (não há 'pending' hoje).
//     Owner vê na agenda imediatamente e pode cancelar.
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

  if (serviceId.length === 0) return { ok: false, error: 'Selecione um serviço.' }
  if (memberOperationId.length === 0) return { ok: false, error: 'Selecione um profissional.' }
  if (startAtLocal.length === 0) return { ok: false, error: 'Selecione data e horário.' }

  // Login gate (brief 0077 Grupo A — AC-01/AC-03/AC-04, #1275). Nobody agenda
  // sem login + cadastro completo. Server-side authority: even a tampered UI
  // hits these two refusals. The customer is DERIVED from the authenticated uid.
  const session = await getSessionUser()
  if (!session) return { ok: false, kind: 'needs-login' }
  const sessionUser = await getUserDoc(session.uid)
  if (!sessionUser || !sessionUser.completionCompleted) {
    return { ok: false, kind: 'needs-completion' }
  }

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

  // Touch attribution (brief 0077 AC-11) from the contextual link's params,
  // forwarded as hidden form fields. Backend re-sanitizes (single boundary).
  const attribution = attributionFromParams((k) => formString(formData, k) || null)

  // Customer derived from the logged-in uid (#1275) — NOT from typed PII. The
  // User doc already holds the (completed) PII; we only need the per-org shadow.
  // Idempotent: a returning customer gets their existing shadow. Write-once
  // acquisition lands only on first materialization. Done BEFORE the booking tx
  // so retries on slot contention don't re-materialize the customer.
  const customer = await ensureSelfSignupCustomer(org.id, session.uid, attribution)
  const customerId = customer.customerId
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
    attribution,
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

  // Funnel event (brief 0077 AC-12) — PII-zero touch attribution. Best-effort.
  await emitClientFunnelEvent({
    event: 'appointment_created',
    orgId: org.id,
    customerId,
    ...channelOf(attribution),
  })

  // Auditoria = stream: `commitAppointmentBooking` já emite `appointment.created`
  // (fonte de verdade). Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true, bookingId, orgId: org.id }
}
