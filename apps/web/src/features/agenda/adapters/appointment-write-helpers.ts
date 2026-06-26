// Internal write/saga helpers for the agenda booking actions — extracted from
// the 'use server' module so it stays under the module-size gate. These are NOT
// server actions (never form-invoked directly); they're the imperative-shell
// helpers the actions compose. `AppointmentMutationResult` is type-only imported
// back from ./actions (erased at compile — no runtime cycle).

import { revalidatePath } from 'next/cache'

import type { Appointment, Professional, resolveCatalogItemForUnit } from '@/domain'
import {
  type AppointmentActorRole,
  type CatalogItem,
  computeNoticeMinutes,
  findAppointmentConflicts,
  getBlockSegmentsForDay,
  getOrgDayBoundsUtc,
  isCatalogService,
  isOperational,
} from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'

import { type SlotInput } from '@/features/agenda/core/appointment-form'

import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { emitEvent } from '@/shared/effect-bridge'
import { listAgendaBlocksForUnit } from '@/shared/org/agenda-block-read'
import { listUnitAppointmentsInRange } from '@/shared/org/appointment-read'
import { getProfessionalById } from '@/shared/org/professional-read'
import { assertCustomerIdNotBlocked } from '@/shared/privacy/assert-customer-not-blocked'

import { AuthzError } from '@/shared/org/membership'

export type AppointmentMutationResult =
  | { ok: true; appointmentId: string }
  | { ok: false; error: string; conflicts?: string[] }

// Surfaces the per-org CUSTOMER write-guard (brief 0032, AC-11) as an action
// error instead of a thrown `AuthzError`. Returns null when allowed.
export async function guardCustomerNotBlocked(
  orgId: string,
  customerId: string,
): Promise<{ ok: false; error: string } | null> {
  try {
    await assertCustomerIdNotBlocked(orgId, customerId)
    return null
  } catch (e) {
    if (e instanceof AuthzError) {
      return { ok: false, error: 'Cliente bloqueado neste estabelecimento (exclusão LGPD).' }
    }
    throw e
  }
}

// Helpers return `T | string` (error message) — the form-parser convention used
// across this app (see `parseAppointmentForm`).
export async function loadActiveCatalogService(
  orgId: string,
  serviceId: string,
): Promise<CatalogItem | string> {
  const item = await getCatalogItemById(orgId, serviceId)
  if (!item) return 'Serviço não encontrado'
  if (!isCatalogService(item)) return 'Item não é um serviço'
  if (!item.active) return 'Serviço inativo'
  return item
}

// Approval gate (#753): only `approved` professionals take bookings — re-checked
// on update too (owner could move an appointment onto a non-approved pro).
export async function loadApprovedProfessional(
  orgId: string,
  professionalId: string,
): Promise<Professional | string> {
  const professional = await getProfessionalById(orgId, professionalId)
  if (!professional) return 'Profissional não encontrado'
  if (!isOperational(professional.operationalStatus)) {
    return `Profissional não está operacional para receber agendamentos (status: ${professional.operationalStatus}).`
  }
  return professional
}

// Pre-flight conflict check (blocks + appointment overlap) for a proposed slot.
// Returns a staff-friendly error + labels, or null when the slot is free. The
// in-transaction check at commit time is the authoritative one under contention.
export async function checkSlotConflicts(args: {
  orgId: string
  org: { timezone: string }
  parsed: SlotInput
  startAt: string
  endAt: string
  excludeAppointmentId?: string
}): Promise<{ error: string; conflicts: string[] } | null> {
  const { orgId, org, parsed, startAt, endAt, excludeAppointmentId } = args
  const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(parsed.date, org.timezone)
  const [existing, blocks] = await Promise.all([
    // The authoritative anti-double-book is the DB exclusion constraint at commit
    // time; this is the staff-friendly pre-flight. Reads the day's unit
    // appointments from the typed `appointments` projection under RLS.
    listUnitAppointmentsInRange(orgId, parsed.unitId, dayStart, dayEnd),
    listAgendaBlocksForUnit(orgId, parsed.unitId),
  ])
  const blockSegments = getBlockSegmentsForDay(blocks, parsed.date, org.timezone)
  const conflicts = findAppointmentConflicts({
    proposed: { startAt, endAt },
    professionalId: parsed.professionalId,
    existing,
    blockSegments,
    date: parsed.date,
    tz: org.timezone,
    excludeAppointmentId,
  })
  if (conflicts.length === 0) return null
  const labels = conflicts.map((c) =>
    c.kind === 'appointment' ? 'agendamento existente' : `bloqueio "${c.reason}"`,
  )
  return { error: `Conflito com ${labels.join(', ')}`, conflicts: labels }
}

// Persist the edit event-first: refresh denormalized userIds when the customer
// or professional changed, emit `appointment.updated` (diff of mutable fields),
// and add `appointment.rescheduled` when the start instant moved.
export async function persistAppointmentUpdate(args: {
  orgId: string
  actorUid: string
  appointmentId: string
  parsed: SlotInput & { customerId: string }
  previous: Appointment
  startAt: string
  endAt: string
  resolved: ReturnType<typeof resolveCatalogItemForUnit>
  serviceOrUnitChanged: boolean
}): Promise<AppointmentMutationResult> {
  const { orgId, actorUid, appointmentId, parsed, previous, startAt, endAt, resolved } = args
  const userIdsChanged =
    parsed.customerId !== previous.customerId || parsed.professionalId !== previous.professionalId
  let customerUserId = previous.customerUserId
  let professionalUserId = previous.professionalUserId
  if (userIdsChanged) {
    const userIds = await resolveAppointmentUserIds(orgId, parsed.customerId, parsed.professionalId)
    if (!userIds.ok) return userIds
    customerUserId = userIds.ids.customerUserId
    professionalUserId = userIds.ids.professionalUserId
  }

  const now = new Date().toISOString()
  const isReschedule = startAt !== previous.startAt
  const changes: Record<string, unknown> = {
    unitId: parsed.unitId,
    professionalId: parsed.professionalId,
    serviceId: parsed.serviceId,
    customerId: parsed.customerId,
    startAt,
    endAt,
    customerUserId,
    professionalUserId,
  }
  if (args.serviceOrUnitChanged) {
    changes.servicePriceCentsSnapshot = resolved.priceCents
    changes.serviceDurationMinutesSnapshot = resolved.durationMinutes
    changes.commissionSnapshot = resolved.commission
  }

  const aggPath = `orgs/${orgId}/appointments/${appointmentId}`
  const edited = await emitEvent(AppointmentConfig, aggPath, {
    _tag: 'appointment.updated',
    actorId: actorUid,
    payload: { changes },
  })
  if (!edited.ok) return { ok: false, error: edited.error }
  if (isReschedule) {
    const rescheduledBy: AppointmentActorRole = 'staff'
    const resched = await emitEvent(AppointmentConfig, aggPath, {
      _tag: 'appointment.rescheduled',
      actorId: actorUid,
      payload: {
        newStartAt: startAt,
        newEndAt: endAt,
        rescheduledBy,
        rescheduledAt: now,
        noticeMinutes: computeNoticeMinutes(previous.startAt, now),
      },
    })
    if (!resched.ok) return { ok: false, error: resched.error }
  }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}
