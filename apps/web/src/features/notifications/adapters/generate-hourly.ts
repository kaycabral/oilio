import { createNotification } from '@/domain/aggregates'
import { FirestoreService, type EventValidationError } from '@/domain/effect'
import { decodeAs } from '@/shared/db/converter'
import { Effect, Schema } from 'effect'

const DEFAULT_ORDER_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000

const TenantDoc = Schema.Struct({
  id: Schema.String,
  timezone: Schema.String,
})
type TenantDoc = typeof TenantDoc.Type

const UnitDoc = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
})
type UnitDoc = typeof UnitDoc.Type

const OrderDoc = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
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
    const tenantDocs = yield* firestore.getDocs('tenants')
    let created = 0

    for (const raw of tenantDocs) {
      const tenant = decodeAs(TenantDoc, raw)
      if (!tenant.id) continue

      const unitDocs = yield* firestore.getDocs(`tenants/${tenant.id}/units`)
      const units = unitDocs.map((r) => decodeAs(UnitDoc, r))
      const unitMap = new Map(units.map((u) => [u.id, u]))

      const orderCount = yield* generateOrderStaleNotifications(tenant, unitMap, now)
      created += orderCount
    }

    return created
  })
}

function generateOrderStaleNotifications(
  tenant: TenantDoc,
  unitMap: Map<string, UnitDoc>,
  now: Date,
): Effect.Effect<number, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const orderDocs = yield* firestore.getDocs(`tenants/${tenant.id}/orders`, [
      { kind: 'where', field: 'status', op: '==', value: 'open' },
    ])
    let created = 0

    for (const raw of orderDocs) {
      const order = decodeAs(OrderDoc, raw)
      if (!order.appointmentId) continue

      const apptDoc = yield* firestore.getDoc(
        `tenants/${tenant.id}/appointments/${order.appointmentId}`,
      )
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
        tenantId: tenant.id,
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
