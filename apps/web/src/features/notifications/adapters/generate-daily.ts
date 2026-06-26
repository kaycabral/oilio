import {
  UnitAgendaConfig,
  getBusinessHoursForDay,
  getOrgDayBoundsUtc,
  hhmmToMinutes,
  shiftDateInOrgTz,
  toOrgTime,
  unitBusinessHours,
  type BusinessHours,
} from '@/domain'
import { createNotification } from '@/domain/aggregates'
import { PersistencePort, type EventValidationError } from '@/domain/effect'
import { decodeAs } from '@/shared/db/converter'
import { listAllOrgIds } from '@/shared/db/pg/public-org-directory'
import { getUserById } from '@/shared/db/pg/users-store'
import { Effect, Schema } from 'effect'

// Timezone + hours are the establishment's now (PRD Identidade v2 — moved
// Org→Unit): each unit carries its own tz and agenda union.
const UnitDoc = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  timezone: Schema.String,
  agenda: UnitAgendaConfig,
})
type UnitDoc = typeof UnitDoc.Type

const SubscriptionDoc = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  customerId: Schema.String,
  status: Schema.String,
  currentPeriod: Schema.Struct({ startAt: Schema.String, endAt: Schema.String }),
})

const CustomerDoc = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
})

export function generateDailyNotifications(
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

      for (const unit of units) {
        if (!unit.id) continue

        // Each unit's clock is its own timezone (moved Org→Unit).
        const unitTime = toOrgTime(now.toISOString(), unit.timezone)
        const today = unitTime.dateISO
        const currentMinutes = unitTime.hour * 60 + unitTime.minute

        if (
          !shouldProcessUnit(unitBusinessHours(unit.agenda), today, unit.timezone, currentMinutes)
        )
          continue

        const birthdayCount = yield* generateBirthdayNotifications(orgId, unit, today)
        created += birthdayCount

        const subCount = yield* generateSubscriptionTouchNotifications(orgId, unit, today)
        created += subCount
      }
    }

    return created
  })
}

function shouldProcessUnit(
  businessHours: BusinessHours | null,
  today: string,
  tz: string,
  currentMinutes: number,
): boolean {
  const ranges = getBusinessHoursForDay(businessHours, today, tz)
  if (ranges.length === 0) return currentMinutes >= 300 && currentMinutes <= 360

  // SPIKE (multi-interval): reminders key off the day's earliest opening.
  const openMinutes = Math.min(...ranges.map((r) => hhmmToMinutes(r.open)))
  const windowStart = openMinutes - 45
  const windowEnd = openMinutes - 15
  return currentMinutes >= windowStart && currentMinutes <= windowEnd
}

function generateBirthdayNotifications(
  orgId: string,
  unit: UnitDoc,
  today: string,
): Effect.Effect<number, EventValidationError, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    const monthDay = today.slice(5)
    const customerDocs = yield* persistence.getDocs(`orgs/${orgId}/customers`)
    let created = 0

    for (const raw of customerDocs) {
      const customer = decodeAs(CustomerDoc, raw)
      if (!customer.userId) continue
      // birthDate is PII — it lives on the global `users/{uid}` record (no org_id,
      // not event-sourced, no RLS), NOT the org-scoped customer doc (which omits
      // all PII). On Postgres that record is the dedicated `users` table, read by
      // uid via the users-store — this adapter joins the two via `customer.userId`
      // (the port's projection seam keys on aggregate_path, which `users` lacks).
      // Best-effort cross-org sweep: a customer with no resolvable birthDate simply
      // gets no reminder — one unreadable record must not abort the whole sweep.
      const user = yield* Effect.promise(() => getUserById(customer.userId))
      if (!user) continue
      const birthDate = 'birthDate' in user ? user.birthDate : null
      if (!birthDate) continue

      const customerMonthDay = birthDate.slice(5)
      if (customerMonthDay !== monthDay) continue

      const { endUtc } = getOrgDayBoundsUtc(today, unit.timezone)
      const eventKey = `birthday-${today}-customer-${customer.id}-unit-${unit.id}`

      const result = yield* createNotification({
        orgId,
        unitId: unit.id,
        type: 'birthday',
        source: 'cron',
        customerId: customer.id,
        appointmentId: null,
        subscriptionId: null,
        payload: { date: today },
        eventKey,
        validUntil: endUtc,
        actorId: 'system:cron-daily',
      })
      if (result) created++
    }

    return created
  })
}

function generateSubscriptionTouchNotifications(
  orgId: string,
  unit: UnitDoc,
  today: string,
): Effect.Effect<number, EventValidationError, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    const subDocs = yield* persistence.getDocs(`orgs/${orgId}/subscriptions`, [
      { kind: 'where', field: 'status', op: 'in', value: ['active', 'past_due'] },
    ])
    let created = 0

    const tomorrow = shiftDateInOrgTz(today, 1, unit.timezone)
    const yesterday = shiftDateInOrgTz(today, -1, unit.timezone)
    const sevenDaysAgo = shiftDateInOrgTz(today, -7, unit.timezone)

    for (const raw of subDocs) {
      const sub = decodeAs(SubscriptionDoc, raw)
      if (!sub.currentPeriod?.endAt) continue

      const endDate = toOrgTime(sub.currentPeriod.endAt, unit.timezone).dateISO
      const touches = matchSubscriptionTouches(endDate, tomorrow, yesterday, sevenDaysAgo)

      for (const touch of touches) {
        const eventKey = `${touch.type}-sub-${sub.id}-unit-${unit.id}`
        const result = yield* createNotification({
          orgId,
          unitId: unit.id,
          type: touch.type,
          source: 'cron',
          customerId: sub.customerId,
          appointmentId: null,
          subscriptionId: sub.id,
          payload: { periodEndDate: endDate },
          eventKey,
          validUntil: touch.validUntil,
          actorId: 'system:cron-daily',
        })
        if (result) created++
      }
    }

    return created
  })
}

type SubscriptionTouch = {
  type: 'subscription_expiring_tomorrow' | 'subscription_expired' | 'subscription_overdue_followup'
  validUntil: string | null
}

function matchSubscriptionTouches(
  endDate: string,
  tomorrow: string,
  yesterday: string,
  sevenDaysAgo: string,
): SubscriptionTouch[] {
  const touches: SubscriptionTouch[] = []

  if (endDate === tomorrow) {
    touches.push({ type: 'subscription_expiring_tomorrow', validUntil: null })
  }
  if (endDate === yesterday) {
    touches.push({ type: 'subscription_expired', validUntil: null })
  }
  if (endDate === sevenDaysAgo) {
    touches.push({ type: 'subscription_overdue_followup', validUntil: null })
  }

  return touches
}
