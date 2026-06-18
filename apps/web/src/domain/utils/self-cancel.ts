// Customer self-cancel eligibility (#845).
//
// Self-cancel runs against the org's `cancellationPolicy` instead of
// the unconditional staff path. When `policy.enabled` is true, the
// customer must cancel ≥ `minNoticeMinutes` before `appointment.startAt`.
// Already-cancelled or already-completed appointments can't be cancelled
// again. Past appointments (startAt ≤ now) can't be self-cancelled even
// if the policy is disabled — that case becomes a no-show concern, not
// a cancellation.
//
// Tracking on the Appointment doc is populated regardless of this gate;
// the gate only decides whether the *customer* can perform the action.
// Staff still cancels through the agenda path with no policy gate.

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
      // Minutes remaining until the customer falls inside the
      // no-cancel-allowed window. Negative when the appointment has
      // already started. Always populated for client-side messaging.
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
