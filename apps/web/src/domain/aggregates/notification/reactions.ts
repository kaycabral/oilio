import { Effect, Schema } from 'effect'

import { aggregateRef, collectionRef } from '@/domain/effect'
import {
  appendEvent,
  type EventEnvelope,
  type EventValidationError,
} from '@/domain/effect/event-store'
import { PersistencePort } from '@/domain/effect/services'
import type { EventReaction } from '../_shared/reactions'
import { UnitConfig } from '../unit/config'
import { NotificationConfig } from './config'
import { createNotification } from './helpers'
import type { NotificationType } from './types'

// Reaction payloads as delivered by `dispatchNotificationReactions` (the caller
// passes these explicitly — see customers/subscription-charges actions). Decoded
// here so handlers read typed fields with no `as`.
const NewCustomerPayload = Schema.Struct({
  orgId: Schema.String,
  name: Schema.String,
  mobile: Schema.String,
})
const ChargeFailedPayload = Schema.Struct({
  reason: Schema.String,
  orgId: Schema.String,
  subscriptionId: Schema.String,
})
const SubscriptionActivatedPayload = Schema.Struct({
  orgId: Schema.String,
  subscriptionId: Schema.String,
})

function createNotificationForUnits(
  envelope: EventEnvelope,
  orgId: string,
  opts: {
    type: NotificationType
    customerId: string | null
    subscriptionId: string | null
    eventKeyPrefix: string
    payload: Record<string, unknown>
    validUntil: string | null
  },
): Effect.Effect<void, EventValidationError, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    const unitDocs = yield* persistence.getDocs(collectionRef(UnitConfig, orgId))

    for (const unitDoc of unitDocs) {
      const idValue = unitDoc['id']
      const unitId = typeof idValue === 'string' ? idValue : ''
      if (!unitId) continue

      yield* createNotification({
        orgId,
        unitId,
        type: opts.type,
        source: 'event',
        customerId: opts.customerId,
        appointmentId: null,
        subscriptionId: opts.subscriptionId,
        payload: opts.payload,
        eventKey: `${opts.eventKeyPrefix}-unit-${unitId}`,
        validUntil: opts.validUntil,
        actorId: envelope.actorId,
      })
    }
  })
}

export const newCustomerReaction: EventReaction<PersistencePort, EventValidationError> = {
  trigger: 'customer.created',
  handle: (envelope) => {
    const p = Schema.decodeUnknownSync(NewCustomerPayload)(envelope.payload)
    return createNotificationForUnits(envelope, p.orgId, {
      type: 'new_customer',
      customerId: envelope.actorId,
      subscriptionId: null,
      eventKeyPrefix: `new_customer-${envelope.actorId}`,
      payload: { customerName: p.name, customerMobile: p.mobile },
      validUntil: null,
    })
  },
}

export const paymentFailureReaction: EventReaction<PersistencePort, EventValidationError> = {
  trigger: 'subscription.charge_failed',
  handle: (envelope) => {
    const p = Schema.decodeUnknownSync(ChargeFailedPayload)(envelope.payload)
    return createNotificationForUnits(envelope, p.orgId, {
      type: 'payment_failure',
      customerId: null,
      subscriptionId: p.subscriptionId,
      eventKeyPrefix: `payment_failure-sub-${p.subscriptionId}-v${envelope.version}`,
      payload: { reason: p.reason, subscriptionId: p.subscriptionId },
      validUntil: null,
    })
  },
}

const SUBSCRIPTION_EXPIRY_TYPES: NotificationType[] = [
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
]

export const subscriptionActivatedReaction: EventReaction<PersistencePort, EventValidationError> = {
  trigger: 'subscription.activated',
  handle: (envelope) => {
    const p = Schema.decodeUnknownSync(SubscriptionActivatedPayload)(envelope.payload)
    return Effect.gen(function* () {
      const persistence = yield* PersistencePort
      const notifications = yield* persistence.getDocs(collectionRef(NotificationConfig, p.orgId), [
        { kind: 'where', field: 'subscriptionId', op: '==', value: p.subscriptionId },
        { kind: 'where', field: 'dispatchedAt', op: '==', value: null },
      ])

      for (const raw of notifications) {
        const notifId = raw['id']
        const notifType = raw['type']
        if (typeof notifId !== 'string' || !notifId || typeof notifType !== 'string') continue
        if (!SUBSCRIPTION_EXPIRY_TYPES.some((t) => t === notifType)) continue

        yield* appendEvent(NotificationConfig, aggregateRef(NotificationConfig, p.orgId, notifId), {
          _tag: 'notification.expired',
          actorId: envelope.actorId,
          payload: {},
        })
      }
    })
  },
}

export const notificationReactions = [
  newCustomerReaction,
  paymentFailureReaction,
  subscriptionActivatedReaction,
] as const
