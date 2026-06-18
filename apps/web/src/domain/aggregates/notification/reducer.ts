import type { EventMeta } from '@/domain/effect/event-store'
import type { NotificationEvent } from './events'
import type { NotificationState } from './types'

export function applyNotificationEvent(
  state: NotificationState,
  event: NotificationEvent,
  meta: EventMeta,
): NotificationState {
  const base = { ...state, _version: meta.version }

  switch (event._tag) {
    case 'notification.created': {
      return {
        ...base,
        id: meta.actorId,
        orgId: event.orgId,
        unitId: event.unitId,
        type: event.type,
        customerId: event.customerId,
        appointmentId: event.appointmentId,
        subscriptionId: event.subscriptionId,
        payload: event.payload,
        source: event.source,
        eventKey: event.eventKey,
        createdAt: meta.timestamp,
        validUntil: event.validUntil,
      }
    }
    case 'notification.dispatched': {
      return {
        ...base,
        dispatchedAt: meta.timestamp,
        dispatchedChannel: event.channel,
        dispatchedBody: event.templateBody,
      }
    }
    case 'notification.read':
      return { ...base, readAt: meta.timestamp }
    case 'notification.snoozed': {
      return { ...base, snoozedUntil: event.snoozedUntil }
    }
    case 'notification.expired':
      return { ...base, validUntil: meta.timestamp }
  }
}
