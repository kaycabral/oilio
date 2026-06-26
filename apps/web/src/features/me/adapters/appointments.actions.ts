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
import {
  type AppointmentRow,
  rowToDoc as apptRowToDoc,
} from '@/shared/db/pg/effect/appointment-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { getUnitById } from '@/shared/org/unit-read'
import { Schema } from 'effect'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

// Read of a single appointment by id within one org (brief 0061 § Grupo C /
// AC-04). Single-org read keyed on `aggregate_path` under RLS. The unit isn't
// known before the read, so no `app.current_unit` pin (the org-scoped RLS policy
// still applies).
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

// Read the live cancellation policy from a unit's appointment agenda (typed
// projection under RLS). Returns `undefined` for a missing unit or a
// non-appointment agenda (no policy exists there); `normalizeCancellationPolicy`
// then yields the default. Used only as the legacy fallback when the appointment
// has no commit-time snapshot. The policy lives on the UNIT's appointment agenda
// now (PRD Identidade v2 — moved Org→Unit).
async function readLiveUnitCancellationPolicy(orgId: string, unitId: string): Promise<unknown> {
  const unit = await getUnitById(orgId, unitId)
  if (unit && unit.agenda.mode === 'appointment') {
    return unit.agenda.cancellationPolicy
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

  const appointment = await loadAppointmentById(input.orgId, input.appointmentId)
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
