import type { AggregateConfig } from '@/domain/effect/event-store'
import { NotificationEventSchema, type NotificationEvent } from './events'
import { applyNotificationEvent } from './reducer'
import { INITIAL_NOTIFICATION_STATE, type NotificationState } from './types'

export const NotificationConfig: AggregateConfig<NotificationState, NotificationEvent> = {
  type: 'notification',
  initialState: INITIAL_NOTIFICATION_STATE,
  reducer: applyNotificationEvent,
  schema: NotificationEventSchema,
  currentSchemaVersion: 1,
}
