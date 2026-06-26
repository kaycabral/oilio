// Functional core for the edit (reschedule) decisions that don't need I/O:
//  - which customer the edit is allowed to target, and
//  - whether the financial snapshot must refresh.
// The adapter (agenda.actions.updateAppointment) still owns the Firestore reads,
// conflict probe and scope enforcement; it calls these to decide, not to fetch.

import type { Appointment } from '@/domain'
import type { ParsedAppointment } from '@/features/agenda/core/appointment-form'

export type EditDecision<T> = { ok: true; value: T } | { ok: false; error: string }

/** An edit may not create a customer (that's a create-only path) and must target
 *  an existing one. Narrows `customerId` to a non-null string for the caller. */
export function validateEditableCustomer(
  parsed: Pick<ParsedAppointment, 'newCustomer' | 'customerId'>,
): EditDecision<{ customerId: string }> {
  if (parsed.newCustomer) {
    return { ok: false, error: 'Cadastrar cliente novo só ao criar agendamento' }
  }
  if (!parsed.customerId) {
    return { ok: false, error: 'Cliente é obrigatório' }
  }
  return { ok: true, value: { customerId: parsed.customerId } }
}

/** snapshot-on-use (ADR 0010): editing only the date/time keeps the original
 *  commit-time snapshot — the owner moved the slot, not the financial contract.
 *  Changing the service or the unit re-snapshots from the current definition.
 *  Returns both the flag (the caller forwards it to the write) and the duration
 *  to use for the new slot bounds. */
export function decideSnapshotRefresh(args: {
  parsed: Pick<ParsedAppointment, 'serviceId' | 'unitId'>
  previous: Pick<Appointment, 'serviceId' | 'unitId' | 'serviceDurationMinutesSnapshot'>
  resolvedDurationMinutes: number
}): { serviceOrUnitChanged: boolean; effectiveDurationMinutes: number } {
  const serviceOrUnitChanged =
    args.parsed.serviceId !== args.previous.serviceId || args.parsed.unitId !== args.previous.unitId
  return {
    serviceOrUnitChanged,
    effectiveDurationMinutes: serviceOrUnitChanged
      ? args.resolvedDurationMinutes
      : args.previous.serviceDurationMinutesSnapshot,
  }
}
