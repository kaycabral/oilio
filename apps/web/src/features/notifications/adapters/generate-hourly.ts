import { createNotification } from '@/domain/aggregates'
import { FirestoreService, type EventValidationError } from '@/domain/effect'
import { decodeAs } from '@/shared/db/converter'
import { Effect, Schema } from 'effect'

const DEFAULT_ORDER_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000

const OrgDoc = Schema.Struct({
  id: Schema.String,
  timezone: Schema.String,
})
type OrgDoc = typeof OrgDoc.Type

const UnitDoc = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
})
type UnitDoc = typeof UnitDoc.Type

const OrderDoc = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  status: Schema.String,
  appointmentId: Schema.NullOr(Schema.String),
})

const AppointmentDoc = Schema.Struct({
  id: Schema.String,
  unitId: Schema.String,
  startAt: Schema.String,
  serviceDurationMinutesSnapshot: Schema.Number,
})

export function generateHourlyNotifications(
  now: Date = new Date(),
): Effect.Effect<number, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const orgDocs = yield* firestore.getDocs('orgs')
    let created = 0

    for (const raw of orgDocs) {
      const org = decodeAs(OrgDoc, raw)
      if (!org.id) continue

      const unitDocs = yield* firestore.getDocs(`orgs/${org.id}/units`)
      const units = unitDocs.map((r) => decodeAs(UnitDoc, r))
      const unitMap = new Map(units.map((u) => [u.id, u]))

      const orderCount = yield* generateOrderStaleNotifications(org, unitMap, now)
      created += orderCount
    }

    return created
  })
}

function generateOrderStaleNotifications(
  org: OrgDoc,
  unitMap: Map<string, UnitDoc>,
  now: Date,
): Effect.Effect<number, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const orderDocs = yield* firestore.getDocs(`orgs/${org.id}/orders`, [
      { kind: 'where', field: 'status', op: '==', value: 'open' },
    ])
    let created = 0

    for (const raw of orderDocs) {
      const order = decodeAs(OrderDoc, raw)
      if (!order.appointmentId) continue

      const apptDoc = yield* firestore.getDoc(`orgs/${org.id}/appointments/${order.appointmentId}`)
      if (!apptDoc) continue

      const appointment = decodeAs(AppointmentDoc, apptDoc)
      const serviceEndMs =
        new Date(appointment.startAt).getTime() +
        appointment.serviceDurationMinutesSnapshot * 60 * 1000
      const staleAfterMs = serviceEndMs + DEFAULT_ORDER_STALE_THRESHOLD_MS

      if (now.getTime() < staleAfterMs) continue

      const unitId = appointment.unitId
      if (!unitId || !unitMap.has(unitId)) continue

      const eventKey = `order_stale-order-${order.id}-unit-${unitId}`
      const result = yield* createNotification({
        orgId: org.id,
        unitId,
        type: 'order_stale',
        source: 'cron',
        customerId: null,
        appointmentId: order.appointmentId,
        subscriptionId: null,
        payload: { orderId: order.id, serviceEndedAt: new Date(serviceEndMs).toISOString() },
        eventKey,
        validUntil: null,
        actorId: 'system:cron-hourly',
      })
      if (result) created++
    }

    return created
  })
}
