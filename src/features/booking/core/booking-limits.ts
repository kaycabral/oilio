import { type Appointment, type BookingLimits, getOrgDayBoundsUtc, toOrgTime } from '@/domain'

export type BookingLimitsCheck =
  | { kind: 'ok' }
  | {
      kind: 'reschedule-required'
      existingAppointment: { id: string; startAt: string }
      maxPerDay: number
    }
  | {
      kind: 'blocked'
      rule: 'maxConcurrent' | 'requireCompleteBeforeNext'
      message: string
    }

const ACTIVE_STATUSES: Appointment['status'][] = ['scheduled', 'completed']

export function evaluateBookingLimits(args: {
  appointments: Appointment[]
  limits: BookingLimits
  proposedStartAt: string
  orgTimezone: string
  now: Date
}): BookingLimitsCheck {
  const { appointments, limits, proposedStartAt, orgTimezone } = args
  const nowIso = args.now.toISOString()

  if (typeof limits.maxPerDay === 'number' && limits.maxPerDay > 0) {
    const { dateISO: proposedDateISO } = toOrgTime(proposedStartAt, orgTimezone)
    const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(proposedDateISO, orgTimezone)
    const sameDay = appointments.filter(
      (a) => ACTIVE_STATUSES.includes(a.status) && a.startAt >= dayStart && a.startAt <= dayEnd,
    )
    if (sameDay.length >= limits.maxPerDay) {
      const sorted = [...sameDay].sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
      const anchor = sorted[0]
      if (anchor) {
        return {
          kind: 'reschedule-required',
          existingAppointment: { id: anchor.id, startAt: anchor.startAt },
          maxPerDay: limits.maxPerDay,
        }
      }
    }
  }

  if (limits.requireCompleteBeforeNext === true) {
    const pendingFuture = appointments.some((a) => a.status === 'scheduled' && a.startAt > nowIso)
    if (pendingFuture) {
      return {
        kind: 'blocked',
        rule: 'requireCompleteBeforeNext',
        message: 'Conclua seu agendamento atual antes de marcar um novo — política do seu plano.',
      }
    }
  }

  if (typeof limits.maxConcurrent === 'number' && limits.maxConcurrent > 0) {
    const futureScheduled = appointments.filter(
      (a) => a.status === 'scheduled' && a.startAt > nowIso,
    ).length
    if (futureScheduled >= limits.maxConcurrent) {
      return {
        kind: 'blocked',
        rule: 'maxConcurrent',
        message: `Limite de ${limits.maxConcurrent} agendamento(s) futuro(s) simultâneo(s) atingido — política do seu plano.`,
      }
    }
  }

  return { kind: 'ok' }
}
