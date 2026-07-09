import type { Appointment } from '../types/appointment'
import type { CancellationPolicy } from '../types/unit'

export type SelfCancelCheck =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'already_cancelled'
        | 'already_completed'
        | 'already_no_show'
        | 'past'
        | 'outside_window'
      minutesToStart: number
      requiredMinutes?: number
    }

export function canCustomerCancelAppointment(
  appointment: Pick<Appointment, 'status' | 'startAt'>,
  policy: CancellationPolicy,
  now: Date = new Date(),
): SelfCancelCheck {
  const startMs = new Date(appointment.startAt).getTime()
  const nowMs = now.getTime()
  const minutesToStart = Math.floor((startMs - nowMs) / 60_000)

  if (appointment.status === 'cancelled') {
    return { ok: false, reason: 'already_cancelled', minutesToStart }
  }
  if (appointment.status === 'completed') {
    return { ok: false, reason: 'already_completed', minutesToStart }
  }
  if (appointment.status === 'no_show') {
    return { ok: false, reason: 'already_no_show', minutesToStart }
  }
  if (startMs <= nowMs) {
    return { ok: false, reason: 'past', minutesToStart }
  }
  if (policy.enabled && minutesToStart < policy.minNoticeMinutes) {
    return {
      ok: false,
      reason: 'outside_window',
      minutesToStart,
      requiredMinutes: policy.minNoticeMinutes,
    }
  }
  return { ok: true }
}
