import { createNotification } from '@/domain/aggregates'
import { PersistencePort, type EventValidationError } from '@/domain/effect'
import { decodeAs } from '@/shared/db/converter'
import { listAllOrgIds } from '@/shared/db/pg/public-org-directory'
import { Effect, Schema } from 'effect'

const DEFAULT_ORDER_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000

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
): Effect.Effect<number, EventValidationError, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    // Enumerate tenants from the PUBLIC directory (no RLS) — a platform-wide
    // sweep can't read the RLS-guarded `orgs` table under a NOBYPASSRLS runtime
    // role. Each org's data below is read org-scoped (RLS enforced) as usual.
    const orgIds = yield* Effect.promise(() => listAllOrgIds())
    let created = 0

    for (const orgId of orgIds) {
      if (!orgId) continue

      const unitDocs = yield* persistence.getDocs(`orgs/${orgId}/units`)
      const units = unitDocs.map((r) => decodeAs(UnitDoc, r))
      const unitMap = new Map(units.map((u) => [u.id, u]))

      const orderCount = yield* generateOrderStaleNotifications(orgId, unitMap, now)
      created += orderCount
    }

    return created
  })
}

function generateOrderStaleNotifications(
  orgId: string,
  unitMap: Map<string, UnitDoc>,
  now: Date,
): Effect.Effect<number, EventValidationError, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    const orderDocs = yield* persistence.getDocs(`orgs/${orgId}/orders`, [
      { kind: 'where', field: 'status', op: '==', value: 'open' },
    ])
    let created = 0

    for (const raw of orderDocs) {
      const order = decodeAs(OrderDoc, raw)
      if (!order.appointmentId) continue

      const apptDoc = yield* persistence.getDoc(`orgs/${orgId}/appointments/${order.appointmentId}`)
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
        orgId,
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
