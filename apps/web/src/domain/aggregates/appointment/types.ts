import type { Appointment } from '@/domain/types/appointment'

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
  attribution: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
