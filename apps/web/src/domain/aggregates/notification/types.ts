export type NotificationType =
  | 'birthday'
  | 'subscription_expiring_tomorrow'
  | 'subscription_expired'
  | 'subscription_overdue_followup'
  | 'order_stale'
  | 'cash_register_open'
  | 'new_customer'
  | 'payment_failure'

export type NotificationSource = 'cron' | 'event'

export type NotificationState = {
  readonly id: string
  readonly tenantId: string
  readonly unitId: string
  readonly type: NotificationType
  readonly customerId: string | null
  readonly appointmentId: string | null
  readonly subscriptionId: string | null
  readonly payload: Record<string, unknown>
  readonly source: NotificationSource
  readonly eventKey: string
  readonly createdAt: string | null
  readonly readAt: string | null
  readonly dispatchedAt: string | null
  // Snapshot do envio (AC-14) — projetados de notification.dispatched. null
  // enquanto não despachada.
  readonly dispatchedChannel: string | null
  readonly dispatchedBody: string | null
  readonly validUntil: string | null
  readonly snoozedUntil: string | null
  readonly _version: number
}

export const INITIAL_NOTIFICATION_STATE: NotificationState = {
  id: '',
  tenantId: '',
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
