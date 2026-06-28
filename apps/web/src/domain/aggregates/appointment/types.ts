import type { Appointment } from '@/domain/types/appointment'

// AC-05/AC-06 (brief 0025): a projeção cobre o doc operacional INTEIRO, derivado
// só de eventos. `AppointmentState` == `Appointment` + `_version` — nenhum campo
// (snapshots de preço/comissão, origin, tracking de cancel/no-show/reschedule,
// timestamps) é escrito fora do stream. `createdAt`/`updatedAt`/atores derivam do
// envelope do evento.
export type AppointmentState = Appointment & { readonly _version: number }

export const INITIAL_APPOINTMENT_STATE: AppointmentState = {
  id: '',
  orgId: '',
  unitId: '',
  memberOperationId: '',
  customerId: '',
  serviceId: '',
  startAt: '',
  endAt: '',
  status: 'scheduled',
  servicePriceCentsSnapshot: 0,
  serviceDurationMinutesSnapshot: 0,
  commissionSnapshot: null,
  cancellationPolicySnapshot: null,
  customerUserId: '',
  memberOperatorUserId: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
