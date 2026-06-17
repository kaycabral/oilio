import { Appointment, AppointmentActorRole } from '@/domain/types/appointment'
import { Schema } from 'effect'

export const AppointmentCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.created'),
  data: Schema.partial(Appointment),
})

export const AppointmentUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.updated'),
  changes: Schema.partial(Appointment),
})

export const AppointmentCompletedSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.completed'),
})

export const AppointmentCancelledSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.cancelled'),
  cancelledBy: AppointmentActorRole,
  cancelledAt: Schema.String,
  noticeMinutes: Schema.Number,
})

export const AppointmentNoShowSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.no_show'),
  markedAt: Schema.String,
  markedBy: Schema.String,
})

export const AppointmentNoShowRevertedSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.no_show_reverted'),
})

export const AppointmentRescheduledSchema = Schema.Struct({
  _tag: Schema.Literal('appointment.rescheduled'),
  newStartAt: Schema.String,
  newEndAt: Schema.String,
  rescheduledBy: AppointmentActorRole,
  rescheduledAt: Schema.String,
  noticeMinutes: Schema.Number,
})

export const AppointmentEventSchema = Schema.Union(
  AppointmentCreatedSchema,
  AppointmentUpdatedSchema,
  AppointmentCompletedSchema,
  AppointmentCancelledSchema,
  AppointmentNoShowSchema,
  AppointmentNoShowRevertedSchema,
  AppointmentRescheduledSchema,
)

export type AppointmentCreated = typeof AppointmentCreatedSchema.Type
export type AppointmentUpdated = typeof AppointmentUpdatedSchema.Type
export type AppointmentCompleted = typeof AppointmentCompletedSchema.Type
export type AppointmentCancelled = typeof AppointmentCancelledSchema.Type
export type AppointmentNoShow = typeof AppointmentNoShowSchema.Type
export type AppointmentNoShowReverted = typeof AppointmentNoShowRevertedSchema.Type
export type AppointmentRescheduled = typeof AppointmentRescheduledSchema.Type
export type AppointmentEvent = typeof AppointmentEventSchema.Type
