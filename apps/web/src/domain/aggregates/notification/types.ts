import { Schema } from 'effect'

export const NotificationType = Schema.Literal(
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'order_stale',
  'cash_register_open',
  'new_customer',
  'payment_failure',
)
export type NotificationType = typeof NotificationType.Type

export const NotificationSource = Schema.Literal('cron', 'event')
export type NotificationSource = typeof NotificationSource.Type

// Effect Schema for the reduced notification state — the source of truth the
// typed Postgres projector decodes against at the driver boundary (brief 0060,
// Grupo C), mirroring the other 7 aggregates. No PII (`payload` references ids,
// never personal data inline — ADR 0010).
export const NotificationState = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  type: NotificationType,
  customerId: Schema.NullOr(Schema.String),
  appointmentId: Schema.NullOr(Schema.String),
  subscriptionId: Schema.NullOr(Schema.String),
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  source: NotificationSource,
  eventKey: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
  readAt: Schema.NullOr(Schema.String),
  dispatchedAt: Schema.NullOr(Schema.String),
  // Snapshot do envio (AC-14) — projetados de notification.dispatched. null
  // enquanto não despachada.
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
