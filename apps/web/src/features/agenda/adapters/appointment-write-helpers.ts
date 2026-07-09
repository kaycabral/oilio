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

export { resolveCustomerIdForWrite as resolveAppointmentCustomerId } from '@/shared/org/resolve-customer-for-write'

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
    listMemberOperationAppointmentsInRange(orgId, parsed.memberOperationId, {
      startUtc: dayStart,
      endUtc: dayEnd,
    }),
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
