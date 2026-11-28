import { Schema } from 'effect'

export const NotificationType = Schema.Literals([
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'order_stale',
  'cash_register_open',
  'new_customer',
  'payment_failure',
])
export type NotificationType = typeof NotificationType.Type

export const NotificationSource = Schema.Literals(['cron', 'event'])
export type NotificationSource = typeof NotificationSource.Type

export const NotificationState = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  type: NotificationType,
  customerId: Schema.NullOr(Schema.String),
  appointmentId: Schema.NullOr(Schema.String),
  subscriptionId: Schema.NullOr(Schema.String),
  payload: Schema.Record(Schema.String, Schema.Unknown),
  source: NotificationSource,
  eventKey: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
  readAt: Schema.NullOr(Schema.String),
  dispatchedAt: Schema.NullOr(Schema.String),
  dispatchedChannel: Schema.NullOr(Schema.String),
  dispatchedBody: Schema.NullOr(Schema.String),
  validUntil: Schema.NullOr(Schema.String),
  snoozedUntil: Schema.NullOr(Schema.String),
  _version: Schema.Number,
})
export type NotificationState = typeof NotificationState.Type

export const INITIAL_NOTIFICATION_STATE: NotificationState = {
  id: '',
  orgId: '',
  unitId: '',
  type: 'birthday',
  customerId: null,
  appointmentId: null,
  subscriptionId: null,
  payload: {},
  source: 'cron',
  eventKey: '',
  createdAt: null,
  readAt: null,
  dispatchedAt: null,
  dispatchedChannel: null,
  dispatchedBody: null,
  validUntil: null,
  snoozedUntil: null,
  _version: 0,
}
