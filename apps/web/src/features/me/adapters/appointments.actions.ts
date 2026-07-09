'use server'

import {
  Appointment,
  type AppointmentActorRole,
  type AppointmentForOverlap,
  canCustomerCancelAppointment,
  computeNoticeMinutes,
  fromOrgTime,
  getOrgDayBoundsUtc,
  normalizeCancellationPolicy,
} from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx } from '@/domain/effect'
import { loadActiveCatalogService } from '@/features/agenda/adapters/appointment-write-helpers'
import { validateAppointmentWrite } from '@/features/agenda/adapters/validate-appointment-write'
import { formatNoticeWindow } from '@/features/me/core/cancel-notice'
import {
  type AppointmentRow,
  rowToDoc as apptRowToDoc,
} from '@/shared/db/pg/effect/appointment-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { commitSaga, emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { track } from '@/shared/lib/track'
import { listMemberOperationAppointmentsInRange } from '@/shared/org/appointment-read'
import { getUnitById } from '@/shared/org/unit-read'
import { Schema } from 'effect'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

async function loadAppointmentById(
  orgId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>('SELECT * FROM appointments WHERE org_id = $1 AND id = $2', [
        orgId,
        appointmentId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeAppointment(apptRowToDoc(row)) : null
}

export type SelfCancelResult = { ok: true } | { ok: false; error: string }

async function readLiveUnitCancellationPolicy(orgId: string, unitId: string): Promise<unknown> {
  const unit = await getUnitById(orgId, unitId)
  if (unit && unit.agenda.mode === 'appointment') {
    return unit.agenda.cancellationPolicy
  }
  return undefined
}

export async function cancelOwnAppointment(input: {
  orgId: string
  appointmentId: string
}): Promise<SelfCancelResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada — entre de novo.' }

  const appointment = await loadAppointmentById(input.orgId, input.appointmentId)
  if (!appointment) return { ok: false, error: 'Agendamento não encontrado.' }
  if (appointment.customerUserId !== session.uid) {
    return { ok: false, error: 'Agendamento não encontrado.' }
  }

  const policy = appointment.cancellationPolicySnapshot
    ? normalizeCancellationPolicy(appointment.cancellationPolicySnapshot)
    : normalizeCancellationPolicy(
        await readLiveUnitCancellationPolicy(input.orgId, appointment.unitId),
      )

  const check = canCustomerCancelAppointment(appointment, policy)
  if (!check.ok) {
    switch (check.reason) {
      case 'already_cancelled':
        return { ok: false, error: 'Esse agendamento já foi cancelado.' }
      case 'already_completed':
        return { ok: false, error: 'Esse agendamento já foi concluído.' }
      case 'already_no_show':
        return { ok: false, error: 'Esse agendamento foi marcado como falta.' }
      case 'past':
        return { ok: false, error: 'Esse horário já passou.' }
      case 'outside_window':
        return {
          ok: false,
          error: `Cancele com pelo menos ${formatNoticeWindow(check.requiredMinutes ?? 0)} de antecedência.`,
        }
    }
  }

  const now = new Date().toISOString()
  const cancelledBy: AppointmentActorRole = 'customer'
  const cancelledNoticeMinutes = computeNoticeMinutes(appointment.startAt, now)

  const cancelled = await emitEvent(
    AppointmentConfig,
    aggregateRef(AppointmentConfig, input.orgId, input.appointmentId),
    {
      _tag: 'appointment.cancelled',
      actorId: session.uid,
      payload: { cancelledBy, cancelledAt: now, noticeMinutes: cancelledNoticeMinutes },
    },
  )
  if (!cancelled.ok) return { ok: false, error: cancelled.error }

  return { ok: true }
}

export type SelfRescheduleResult = { ok: true } | { ok: false; error: string }

const TIME_RE = /^\d{2}:\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type OwnRescheduleBusyResult =
  | { ok: true; busy: AppointmentForOverlap[] }
  | { ok: false; error: string }

export async function loadOwnRescheduleBusy(input: {
  orgId: string
  appointmentId: string
  date: string
}): Promise<OwnRescheduleBusyResult> {
  if (!DATE_RE.test(input.date)) return { ok: false, error: 'Data inválida.' }

  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada — entre de novo.' }

  const appointment = await loadAppointmentById(input.orgId, input.appointmentId)
  if (!appointment || appointment.customerUserId !== session.uid) {
    return { ok: false, error: 'Agendamento não encontrado.' }
  }

  const unit = await getUnitById(input.orgId, appointment.unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada.' }

  const { startUtc, endUtc } = getOrgDayBoundsUtc(input.date, unit.timezone)
  const busy = await listMemberOperationAppointmentsInRange(
    input.orgId,
    appointment.memberOperationId,
    {
      startUtc,
      endUtc,
    },
  )
  return {
    ok: true,
    busy: busy.map((a) => ({
      id: a.id,
      memberOperationId: a.memberOperationId,
      startAt: a.startAt,
      endAt: a.endAt,
      status: a.status,
    })),
  }
}

export async function rescheduleOwnAppointment(input: {
  orgId: string
  appointmentId: string
  date: string
  startTime: string
}): Promise<SelfRescheduleResult> {
  if (!DATE_RE.test(input.date)) return { ok: false, error: 'Data inválida.' }
  if (!TIME_RE.test(input.startTime)) return { ok: false, error: 'Horário inválido.' }

  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada — entre de novo.' }

  const appointment = await loadAppointmentById(input.orgId, input.appointmentId)
  if (!appointment) return { ok: false, error: 'Agendamento não encontrado.' }
  if (appointment.customerUserId !== session.uid) {
    return { ok: false, error: 'Agendamento não encontrado.' }
  }

  const policy = appointment.cancellationPolicySnapshot
    ? normalizeCancellationPolicy(appointment.cancellationPolicySnapshot)
    : normalizeCancellationPolicy(
        await readLiveUnitCancellationPolicy(input.orgId, appointment.unitId),
      )
  const check = canCustomerCancelAppointment(appointment, policy)
  if (!check.ok) {
    switch (check.reason) {
      case 'already_cancelled':
        return { ok: false, error: 'Esse agendamento já foi cancelado.' }
      case 'already_completed':
        return { ok: false, error: 'Esse agendamento já foi concluído.' }
      case 'already_no_show':
        return { ok: false, error: 'Esse agendamento foi marcado como falta.' }
      case 'past':
        return { ok: false, error: 'Esse horário já passou.' }
      case 'outside_window':
        return {
          ok: false,
          error: `Reagende com pelo menos ${formatNoticeWindow(check.requiredMinutes ?? 0)} de antecedência.`,
        }
    }
  }

  const unit = await getUnitById(input.orgId, appointment.unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada.' }

  const [hh, mm] = input.startTime.split(':').map(Number)
  const newStartAt = fromOrgTime(
    { date: input.date, hour: hh ?? 0, minute: mm ?? 0 },
    unit.timezone,
  )
  const newEndAt = new Date(
    new Date(newStartAt).getTime() + appointment.serviceDurationMinutesSnapshot * 60_000,
  ).toISOString()

  const item = await loadActiveCatalogService(input.orgId, appointment.serviceId)
  if (typeof item === 'string') return { ok: false, error: item }
  const serviceCategoryId = item.categoryId

  const validation = await validateAppointmentWrite({
    orgId: input.orgId,
    unit,
    userId: session.uid,
    surface: 'self_book',
    parsed: {
      unitId: appointment.unitId,
      memberOperationId: appointment.memberOperationId,
      serviceId: appointment.serviceId,
      date: input.date,
      startTime: input.startTime,
    },
    startAt: newStartAt,
    endAt: newEndAt,
    customerId: appointment.customerId,
    serviceCategoryId,
    excludeAppointmentId: appointment.id,
  })
  if (!validation.ok) return { ok: false, error: validation.error }

  const now = new Date().toISOString()
  const apptRef = aggregateRef(AppointmentConfig, input.orgId, input.appointmentId)
  const rescheduledBy: AppointmentActorRole = 'customer'
  const moved = await commitSaga([
    (tx) =>
      appendEventToTx(
        AppointmentConfig,
        apptRef,
        {
          _tag: 'appointment.updated',
          actorId: session.uid,
          payload: { changes: { startAt: newStartAt, endAt: newEndAt } },
        },
        tx,
      ),
    (tx) =>
      appendEventToTx(
        AppointmentConfig,
        apptRef,
        {
          _tag: 'appointment.rescheduled',
          actorId: session.uid,
          payload: {
            newStartAt,
            newEndAt,
            rescheduledBy,
            rescheduledAt: now,
            noticeMinutes: computeNoticeMinutes(appointment.startAt, now),
          },
        },
        tx,
      ),
  ])
  if (!moved.ok) return { ok: false, error: moved.error }

  track('appointment_rescheduled_self_service', {
    org_id: input.orgId,
    user_id: session.uid,
    appointment_id: input.appointmentId,
    from_start: appointment.startAt,
    to_start: newStartAt,
  })

  return { ok: true }
}
