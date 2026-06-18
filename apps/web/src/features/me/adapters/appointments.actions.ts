'use server'

import {
  Appointment,
  type AppointmentActorRole,
  canCustomerCancelAppointment,
  computeNoticeMinutes,
  normalizeCancellationPolicy,
} from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { formatNoticeWindow } from '@/features/me/core/cancel-notice'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { Schema } from 'effect'

// The live cancellation policy lives on the UNIT's appointment agenda now (PRD
// Identidade v2 — moved Org→Unit). A small local projection keeps the converter
// narrow (excess fields ignored) — read only the agenda off the unit doc.
const UnitAgendaProjection = Schema.Struct({
  agenda: Schema.optional(Schema.Unknown),
})

export type SelfCancelResult = { ok: true } | { ok: false; error: string }

// Read the live cancellation policy from a unit's appointment agenda (raw doc
// projection). Returns `undefined` for a missing unit or a non-appointment
// agenda (no policy exists there); `normalizeCancellationPolicy` then yields the
// default. Used only as the legacy fallback when the appointment has no
// commit-time snapshot.
async function readLiveUnitCancellationPolicy(
  orgRef: FirebaseFirestore.DocumentReference,
  unitId: string,
): Promise<unknown> {
  const snap = await orgRef
    .collection('units')
    .withConverter(fsConverter(UnitAgendaProjection))
    .doc(unitId)
    .get()
  const agenda = snap.data()?.agenda
  if (
    typeof agenda === 'object' &&
    agenda !== null &&
    'mode' in agenda &&
    agenda.mode === 'appointment' &&
    'cancellationPolicy' in agenda
  ) {
    return agenda.cancellationPolicy
  }
  return undefined
}

// #845 — Customer self-cancel from `/me/appointments`.
//
// Authorization: a customer can only cancel an appointment where
// `customerUserId === session.uid`. Cross-org access is enforced
// here because the customer doesn't have a org membership — the
// User doc is the only identity bridge (see #832).
//
// Policy: `Org.cancellationPolicy.minNoticeMinutes`. Pure helper
// `canCustomerCancelAppointment` makes the decision so the same logic
// drives the UI (button enabled/disabled) and the server (authorization).
//
// Tracking: `cancelledBy = 'customer'`, `cancelledNoticeMinutes` always
// populated. Audit log lands under the *org* the appointment belongs
// to so the recepção can see "Cliente X cancelou Y" in the same audit
// stream as staff actions.
export async function cancelOwnAppointment(input: {
  orgId: string
  appointmentId: string
}): Promise<SelfCancelResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada — entre de novo.' }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(input.orgId)
  const apptRef = orgRef
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(input.appointmentId)

  const apptSnap = await apptRef.get()
  const appointment = apptSnap.data()
  if (!appointment) return { ok: false, error: 'Agendamento não encontrado.' }
  if (appointment.customerUserId !== session.uid) {
    // Treat as 404 — don't leak existence to a non-owner.
    return { ok: false, error: 'Agendamento não encontrado.' }
  }

  // Snapshot-on-use (#1038): a elegibilidade lê a policy congelada no commit,
  // não a viva — mudar a policy não retroage. Fallback pra policy viva da
  // agenda da unidade (modo appointment) em agendamentos legados sem snapshot.
  // A policy é da Unidade agora (PRD Identidade v2 — movida Org→Unit).
  const policy = appointment.cancellationPolicySnapshot
    ? normalizeCancellationPolicy(appointment.cancellationPolicySnapshot)
    : normalizeCancellationPolicy(await readLiveUnitCancellationPolicy(orgRef, appointment.unitId))

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

  // Event-first: a projeção (status/cancelledAt/By/NoticeMinutes) vem do evento,
  // sem `apptRef.update()` paralelo.
  const cancelled = await emitEvent(
    AppointmentConfig,
    `orgs/${input.orgId}/appointments/${input.appointmentId}`,
    {
      _tag: 'appointment.cancelled',
      actorId: session.uid,
      payload: { cancelledBy, cancelledAt: now, noticeMinutes: cancelledNoticeMinutes },
    },
  )
  if (!cancelled.ok) return { ok: false, error: cancelled.error }

  // Auditoria = stream: o `appointment.cancelled` já registra quem/quando/como.
  // Sem `audit_logs` paralelo (erradicação ES, #1029).
  return { ok: true }
}
