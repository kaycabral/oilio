// Internal write/saga helpers for the agenda booking actions — extracted from
// the 'use server' module so it stays under the module-size gate. These are NOT
// server actions (never form-invoked directly); they're the imperative-shell
// helpers the actions compose. `AppointmentMutationResult` is type-only imported
// back from ./actions (erased at compile — no runtime cycle).

import { revalidatePath } from 'next/cache'

import type { Appointment, MemberOperation, resolveCatalogItemForUnit } from '@/domain'
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
import { aggregateRef } from '@/domain/effect'

import { type SlotInput } from '@/features/agenda/core/appointment-form'

import { resolveAppointmentUserIds } from '@/features/booking/adapters/appointment-user-ids'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { emitEvent, type WriteSecurity } from '@/shared/effect-bridge'
import { listAgendaBlocksForUnit } from '@/shared/org/agenda-block-read'
import { listMemberOperationAppointmentsInRange } from '@/shared/org/appointment-read'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { assertCustomerIdNotBlocked } from '@/shared/privacy/assert-customer-not-blocked'

import { AuthzError, getMembership } from '@/shared/org/membership'

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

// The "pick existing OR register new inline" resolver moved to
// `@/shared/org/resolve-customer-for-write` (brief 0081/#1323), so the walk-in
// order path shares the exact same logic + `canManageCustomers` gate. Re-exported
// here under the original name to keep this module's call-sites stable.
export { resolveCustomerIdForWrite as resolveAppointmentCustomerId } from '@/shared/org/resolve-customer-for-write'

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

// Booking gate: only a BOOKABLE member takes bookings — re-checked on update too
// (owner could move an appointment onto a non-bookable member). Post brief 0076
// "bookable" is the capability `canBeBooked` ∧ operational readiness (the retired
// `BookableProfessional` brand's contract, now a server-side gate): the agenda
// read filters on exactly this (`listBookableMemberOperationsForOrg`), so the write
// path must enforce it too — a member soft-disabled via `canBeBooked=false`
// stays out of the grid AND can't receive a booking through a stale form / deep
// link. Mirrors the read invariant so the two can't drift.
export async function loadApprovedMemberOperation(
  orgId: string,
  memberOperationId: string,
): Promise<MemberOperation | string> {
  const memberOperation = await getMemberOperationById(orgId, memberOperationId)
  if (!memberOperation) return 'Profissional não encontrado'
  if (!isOperational(memberOperation.operationalStatus)) {
    return `Profissional não está operacional para receber agendamentos (status: ${memberOperation.operationalStatus}).`
  }
  const membership = await getMembership(orgId, memberOperation.userId)
  if (!membership || membership.status !== 'active' || !membership.permissions.canBeBooked) {
    return 'Profissional não está habilitado para receber agendamentos (capacidade de agenda desligada).'
  }
  return memberOperation
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
    // time; this is the staff-friendly pre-flight. Reads the professional's day
    // CROSS-UNIT (#1313): the constraint scopes by member_operation regardless of
    // unit, so a slot they already fill in another unit must conflict here too —
    // otherwise the picker offers it and the commit rejects with a misleading
    // "just taken" error. `findAppointmentConflicts` filters by memberOperation.
    listMemberOperationAppointmentsInRange(orgId, parsed.memberOperationId, {
      startUtc: dayStart,
      endUtc: dayEnd,
    }),
    // Blocks stay unit-scoped — a block is a physical closure of THIS unit.
    listAgendaBlocksForUnit(orgId, parsed.unitId),
  ])
  const blockSegments = getBlockSegmentsForDay(blocks, parsed.date, org.timezone)
  const conflicts = findAppointmentConflicts({
    proposed: { startAt, endAt },
    memberOperationId: parsed.memberOperationId,
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
// or memberOperation changed, emit `appointment.updated` (diff of mutable fields),
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
  // Own-scope RLS for the write (brief 0075, #1265) — forwarded to every event
  // append so a self-scoped editor's writes pass the DB own-scope WITH CHECK.
  // Undefined for the balcão (permissive).
  security?: WriteSecurity
}): Promise<AppointmentMutationResult> {
  const { orgId, actorUid, appointmentId, parsed, previous, startAt, endAt, resolved, security } =
    args
  const userIdsChanged =
    parsed.customerId !== previous.customerId ||
    parsed.memberOperationId !== previous.memberOperationId
  let customerUserId = previous.customerUserId
  let memberOperatorUserId = previous.memberOperatorUserId
  if (userIdsChanged) {
    const userIds = await resolveAppointmentUserIds(
      orgId,
      parsed.customerId,
      parsed.memberOperationId,
    )
    if (!userIds.ok) return userIds
    customerUserId = userIds.ids.customerUserId
    memberOperatorUserId = userIds.ids.memberOperatorUserId
  }

  const now = new Date().toISOString()
  const isReschedule = startAt !== previous.startAt
  const changes: Record<string, unknown> = {
    unitId: parsed.unitId,
    memberOperationId: parsed.memberOperationId,
    serviceId: parsed.serviceId,
    customerId: parsed.customerId,
    startAt,
    endAt,
    customerUserId,
    memberOperatorUserId,
  }
  if (args.serviceOrUnitChanged) {
    changes.servicePriceCentsSnapshot = resolved.priceCents
    changes.serviceDurationMinutesSnapshot = resolved.durationMinutes
    changes.commissionSnapshot = resolved.commission
  }

  const apptRef = aggregateRef(AppointmentConfig, orgId, appointmentId)
  const edited = await emitEvent(
    AppointmentConfig,
    apptRef,
    {
      _tag: 'appointment.updated',
      actorId: actorUid,
      payload: { changes },
    },
    security,
  )
  if (!edited.ok) return { ok: false, error: edited.error }
  if (isReschedule) {
    const rescheduledBy: AppointmentActorRole = 'staff'
    const resched = await emitEvent(
      AppointmentConfig,
      apptRef,
      {
        _tag: 'appointment.rescheduled',
        actorId: actorUid,
        payload: {
          newStartAt: startAt,
          newEndAt: endAt,
          rescheduledBy,
          rescheduledAt: now,
          noticeMinutes: computeNoticeMinutes(previous.startAt, now),
        },
      },
      security,
    )
    if (!resched.ok) return { ok: false, error: resched.error }
  }

  revalidatePath('/agenda')
  return { ok: true, appointmentId }
}
