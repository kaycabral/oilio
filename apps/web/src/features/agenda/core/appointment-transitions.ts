import type { Appointment, AppointmentActorRole } from '@/domain'
import { computeNoticeMinutes } from '@/domain'

export type TransitionDecision<T> = { ok: true; value: T } | { ok: false; error: string }

export type CancellationFacts = {
  cancelledBy: AppointmentActorRole
  cancelledAt: string
  noticeMinutes: number
}

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

export function decideUnmarkNoShow(
  existing: Pick<Appointment, 'status'>,
): TransitionDecision<null> {
  if (existing.status !== 'no_show') {
    return { ok: false, error: 'Agendamento não está marcado como não compareceu' }
  }
  return { ok: true, value: null }
}
