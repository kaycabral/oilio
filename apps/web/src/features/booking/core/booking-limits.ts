// Functional core for bookingLimits (brief 0019, Group C). The decision is pure:
// given the customer's appointments + their plan limits + the proposed slot,
// answer whether the booking is allowed. The adapter (check-booking-limits) does
// the single Firestore fetch and hands the rows here. Three independent rules:
//
//   - maxPerDay: would exceed the daily cap → `reschedule-required`, surfacing
//     the existing same-day appointment so the UI routes to reschedule (AC-12).
//   - requireCompleteBeforeNext: any future not-completed appointment blocks a
//     new booking (AC-14).
//   - maxConcurrent: counts future scheduled appointments; blocks the N+1th (AC-13).

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

// Statuses that "count" towards the customer's active footprint. Cancelled and
// no_show appointments are no-ops for limit calculation.
const ACTIVE_STATUSES: Appointment['status'][] = ['scheduled', 'completed']

/** Pure rule evaluation. `appointments` is the customer's set with the
 *  appointment being moved already discounted (the adapter applies the
 *  `excludeAppointmentId` filter before calling). */
export function evaluateBookingLimits(args: {
  appointments: Appointment[]
  limits: BookingLimits
  proposedStartAt: string
  orgTimezone: string
  now: Date
}): BookingLimitsCheck {
  const { appointments, limits, proposedStartAt, orgTimezone } = args
  const nowIso = args.now.toISOString()

  // maxPerDay (AC-12). Match the day of the proposed slot in org tz.
  if (typeof limits.maxPerDay === 'number' && limits.maxPerDay > 0) {
    const { dateISO: proposedDateISO } = toOrgTime(proposedStartAt, orgTimezone)
    const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(proposedDateISO, orgTimezone)
    const sameDay = appointments.filter(
      (a) => ACTIVE_STATUSES.includes(a.status) && a.startAt >= dayStart && a.startAt <= dayEnd,
    )
    if (sameDay.length >= limits.maxPerDay) {
      // Pick the earliest same-day appointment as the reschedule anchor — most
      // actionable for the customer.
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

  // requireCompleteBeforeNext (AC-14). Any future not-completed appointment
  // (status === 'scheduled') blocks the new booking.
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

  // maxConcurrent (AC-13). Counts every future scheduled appointment.
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
