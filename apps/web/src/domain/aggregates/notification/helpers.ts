import crypto from 'node:crypto'

import { Effect } from 'effect'

import {
  appendEvent,
  type EventEnvelope,
  type EventValidationError,
} from '@/domain/effect/event-store'
import { FirestoreService } from '@/domain/effect/services'
import { NotificationConfig } from './config'
import type { NotificationSource, NotificationType } from './types'

export function notificationExists(
  tenantId: string,
  type: string,
  eventKey: string,
  unitId: string,
): Effect.Effect<boolean, never, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const docs = yield* firestore.getDocs(`tenants/${tenantId}/notifications`, [
      { kind: 'where', field: 'type', op: '==', value: type },
      { kind: 'where', field: 'eventKey', op: '==', value: eventKey },
      { kind: 'where', field: 'unitId', op: '==', value: unitId },
      { kind: 'limit', count: 1 },
    ])
    return docs.length > 0
  })
}

export type CreateNotificationInput = {
  tenantId: string
  unitId: string
  type: NotificationType
  source: NotificationSource
  customerId: string | null
  appointmentId: string | null
  subscriptionId: string | null
  payload: Record<string, unknown>
  eventKey: string
  validUntil: string | null
  actorId: string
}

export function createNotification(
  input: CreateNotificationInput,
): Effect.Effect<EventEnvelope | null, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const exists = yield* notificationExists(
      input.tenantId,
      input.type,
      input.eventKey,
      input.unitId,
    )
    if (exists) return null

    const notificationId = crypto.randomUUID()
    const envelope = yield* appendEvent(
      NotificationConfig,
      `tenants/${input.tenantId}/notifications/${notificationId}`,
      {
        _tag: 'notification.created',
        actorId: input.actorId,
        payload: {
          tenantId: input.tenantId,
          unitId: input.unitId,
          type: input.type,
          customerId: input.customerId,
          appointmentId: input.appointmentId,
          subscriptionId: input.subscriptionId,
          payload: input.payload,
          source: input.source,
          eventKey: input.eventKey,
          validUntil: input.validUntil,
        },
      },
    )
    return envelope
  })
}
