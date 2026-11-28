import { Schema, Struct } from 'effect'

import { NonEmptyString, NonNegativeInt } from '@/domain/value-objects'
import { Attribution } from './attribution'
import { CommissionRule } from './member-operation'
import { CancellationPolicy } from './unit'

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const
export const AppointmentStatus = Schema.Literals(APPOINTMENT_STATUSES)
export type AppointmentStatus = typeof AppointmentStatus.Type

export const AppointmentActorRole = Schema.Literals(['customer', 'staff', 'system'])
export type AppointmentActorRole = typeof AppointmentActorRole.Type

export const Appointment = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  memberOperationId: Schema.String,
  customerId: Schema.String,
  serviceId: Schema.String,
  startAt: Schema.String,
  endAt: Schema.String,
  status: AppointmentStatus,
  servicePriceCentsSnapshot: NonNegativeInt,
  serviceDurationMinutesSnapshot: NonNegativeInt,
  commissionSnapshot: Schema.NullOr(CommissionRule),
  cancellationPolicySnapshot: Schema.NullOr(CancellationPolicy),
  customerUserId: NonEmptyString,
  memberOperatorUserId: Schema.NullOr(Schema.String),
  cancelledAt: Schema.optional(Schema.String),
  cancelledBy: Schema.optional(AppointmentActorRole),
  cancelledNoticeMinutes: Schema.optional(Schema.Number),
  rescheduledAt: Schema.optional(Schema.String),
  rescheduledBy: Schema.optional(AppointmentActorRole),
  rescheduledNoticeMinutes: Schema.optional(Schema.Number),
  noShowMarkedAt: Schema.optional(Schema.String),
  noShowMarkedBy: Schema.optional(Schema.String),
  attribution: Schema.NullOr(Attribution),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type Appointment = typeof Appointment.Type

export function computeNoticeMinutes(scheduledStartAt: string, actionAt: string): number {
  const start = new Date(scheduledStartAt).getTime()
  const at = new Date(actionAt).getTime()
  return Math.floor((start - at) / 60_000)
}
