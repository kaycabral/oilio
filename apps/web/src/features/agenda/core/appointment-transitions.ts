// Functional core for the appointment status machine. Each function answers a
// single question — "is this transition allowed, and what facts does the event
// payload need?" — from plain data (existing status/startAt + the current
// instant), with ZERO I/O. The adapter (agenda.actions) does the Firestore read
// + `emitEvent`; the *decision* lives here so it's unit-testable without an
// emulator. Keep the error strings here too: they're the user-facing contract of
// the transition, and pinning them in pure code lets tests assert them cheaply.

import type { Appointment, AppointmentActorRole } from '@/domain'
import { computeNoticeMinutes } from '@/domain'

/** A transition either proceeds (carrying the facts the event needs) or is
 *  refused with a user-facing reason. Mirrors the `{ ok }` shape the actions
 *  already return, so the adapter forwards it verbatim. */
export type TransitionDecision<T> = { ok: true; value: T } | { ok: false; error: string }

export type CancellationFacts = {
  cancelledBy: AppointmentActorRole
  cancelledAt: string
  noticeMinutes: number
}

/** Cancel is allowed from any live status; only an already-cancelled booking is
 *  refused. `actor` is a parameter (not hardcoded) so the self-cancel flow can
 *  reuse this with `'customer'`. */
export function decideCancel(
  existing: Pick<Appointment, 'status' | 'startAt'>,
  actor: AppointmentActorRole,
  nowIso: string,
): TransitionDecision<CancellationFacts> {
  if (existing.status === 'cancelled') {
    return { ok: false, error: 'Agendamento já está cancelado' }
  }
  return {
    ok: true,
    value: {
      cancelledBy: actor,
      cancelledAt: nowIso,
      noticeMinutes: computeNoticeMinutes(existing.startAt, nowIso),
    },
  }
}

/** No-show only applies AFTER the slot started (before that it isn't missed —
 *  the path is cancel) and only from a live booking (not already no-show, not
 *  cancelled). Wiki: 04-Roadmap-Politica-Cancelamento § Quando o botão libera. */
export function decideNoShow(
  existing: Pick<Appointment, 'status' | 'startAt'>,
  now: Date,
): TransitionDecision<null> {
  if (now.getTime() < new Date(existing.startAt).getTime()) {
    return { ok: false, error: 'Só é possível marcar não compareceu após o horário marcado' }
  }
  if (existing.status === 'no_show') {
    return { ok: false, error: 'Agendamento já está marcado como não compareceu' }
  }
  if (existing.status === 'cancelled') {
    return { ok: false, error: 'Agendamento cancelado não pode virar não compareceu' }
  }
  return { ok: true, value: null }
}

/** Reverting a no-show only makes sense from a no-show status. */
export function decideUnmarkNoShow(
  existing: Pick<Appointment, 'status'>,
): TransitionDecision<null> {
  if (existing.status !== 'no_show') {
    return { ok: false, error: 'Agendamento não está marcado como não compareceu' }
  }
  return { ok: true, value: null }
}
