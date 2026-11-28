import { Schema } from 'effect'

const NotificationTypeSchema = Schema.Union([
  Schema.Literal('birthday'),
  Schema.Literal('subscription_expiring_tomorrow'),
  Schema.Literal('subscription_expired'),
  Schema.Literal('subscription_overdue_followup'),
  Schema.Literal('order_stale'),
  Schema.Literal('cash_register_open'),
  Schema.Literal('new_customer'),
  Schema.Literal('payment_failure'),
])

const NotificationSourceSchema = Schema.Union([Schema.Literal('cron'), Schema.Literal('event')])

const NullableString = Schema.NullOr(Schema.String)

export const NotificationCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('notification.created'),
  orgId: Schema.String,
  unitId: Schema.String,
  type: NotificationTypeSchema,
  customerId: NullableString,
  appointmentId: NullableString,
  subscriptionId: NullableString,
  payload: Schema.Record(Schema.String, Schema.Unknown),
  source: NotificationSourceSchema,
  eventKey: Schema.String,
  validUntil: NullableString,
})

export const NotificationDispatchedSchema = Schema.Struct({
  _tag: Schema.Literal('notification.dispatched'),
  channel: Schema.String,
  templateBody: Schema.String,
})

export const NotificationReadSchema = Schema.Struct({
  _tag: Schema.Literal('notification.read'),
})

export const NotificationSnoozedSchema = Schema.Struct({
  _tag: Schema.Literal('notification.snoozed'),
  snoozedUntil: Schema.String,
})

export const NotificationExpiredSchema = Schema.Struct({
  _tag: Schema.Literal('notification.expired'),
})

export const NotificationEventSchema = Schema.Union([
  NotificationCreatedSchema,
  NotificationDispatchedSchema,
  NotificationReadSchema,
  NotificationSnoozedSchema,
  NotificationExpiredSchema,
])

export type NotificationCreated = typeof NotificationCreatedSchema.Type
export type NotificationDispatched = typeof NotificationDispatchedSchema.Type
export type NotificationRead = typeof NotificationReadSchema.Type
export type NotificationSnoozed = typeof NotificationSnoozedSchema.Type
export type NotificationExpired = typeof NotificationExpiredSchema.Type
export type NotificationEvent = typeof NotificationEventSchema.Type
