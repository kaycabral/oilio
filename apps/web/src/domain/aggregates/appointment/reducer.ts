import type { EventMeta } from '@/domain/effect/event-store'
import type { AppointmentEvent } from './events'
import type { AppointmentState } from './types'

export function applyAppointmentEvent(
  state: AppointmentState,
  event: AppointmentEvent,
  meta: EventMeta,
): AppointmentState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'appointment.created': {
      return {
        ...base,
        ...event.data,
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
        status: 'scheduled',
      }
    }
    case 'appointment.updated': {
      return { ...base, ...event.changes }
    }
    case 'appointment.completed':
      return { ...base, status: 'completed' }
    case 'appointment.cancelled':
      return {
        ...base,
        status: 'cancelled',
        cancelledAt: event.cancelledAt,
        cancelledBy: event.cancelledBy,
        cancelledNoticeMinutes: event.noticeMinutes,
      }
    case 'appointment.no_show':
      return {
        ...base,
        status: 'no_show',
        noShowMarkedAt: event.markedAt,
        noShowMarkedBy: event.markedBy,
      }
    case 'appointment.no_show_reverted':
      // Volta pra scheduled; `noShowMarkedAt/By` ficam como histórico do marker
      // anterior (status é a fonte da verdade do estado atual).
      return { ...base, status: 'scheduled' }
    case 'appointment.rescheduled':
      return {
        ...base,
        startAt: event.newStartAt,
        endAt: event.newEndAt,
        rescheduledAt: event.rescheduledAt,
        rescheduledBy: event.rescheduledBy,
        rescheduledNoticeMinutes: event.noticeMinutes,
      }
  }
}
