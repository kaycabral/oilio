import type { Appointment } from '@/domain'
import type { ParsedAppointment } from '@/features/agenda/core/appointment-form'

export type EditDecision<T> = { ok: true; value: T } | { ok: false; error: string }

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
