import {
  BusinessHours,
  getBusinessHoursForDay,
  getOrgDayBoundsUtc,
  hhmmToMinutes,
  shiftDateInOrgTz,
  toOrgTime,
} from '@/domain'
import { createNotification } from '@/domain/aggregates'
import { FirestoreService, type EventValidationError } from '@/domain/effect'
import { decodeAs } from '@/shared/db/converter'
import { Effect, Option, Schema } from 'effect'

const OrgDoc = Schema.Struct({
  id: Schema.String,
  timezone: Schema.String,
})
type OrgDoc = typeof OrgDoc.Type

const UnitDoc = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  businessHours: Schema.NullOr(BusinessHours),
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

// birthDate is PII — it lives on the `users/{uid}` doc, not the org-scoped
// customer doc (the customer doc omits all PII). The birthday cron joins the
// two via `customer.userId`.
const UserBirthDateDoc = Schema.Struct({
  birthDate: Schema.NullOr(Schema.String),
})

export function generateDailyNotifications(
  now: Date = new Date(),
): Effect.Effect<number, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const orgDocs = yield* firestore.getDocs('orgs')
    let created = 0

    for (const raw of orgDocs) {
      const org = decodeAs(OrgDoc, raw)
      if (!org.id || !org.timezone) continue

      const orgTime = toOrgTime(now.toISOString(), org.timezone)
      const today = orgTime.dateISO
      const currentMinutes = orgTime.hour * 60 + orgTime.minute

      const unitDocs = yield* firestore.getDocs(`orgs/${org.id}/units`)
      const units = unitDocs.map((r) => decodeAs(UnitDoc, r))

      for (const unit of units) {
        if (!unit.id) continue

        if (!shouldProcessUnit(unit.businessHours, today, org.timezone, currentMinutes)) continue

        const birthdayCount = yield* generateBirthdayNotifications(org, unit, today)
        created += birthdayCount

        const subCount = yield* generateSubscriptionTouchNotifications(org, unit, today)
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
  org: OrgDoc,
  unit: UnitDoc,
  today: string,
): Effect.Effect<number, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const monthDay = today.slice(5)
    const customerDocs = yield* firestore.getDocs(`orgs/${org.id}/customers`)
    let created = 0

    for (const raw of customerDocs) {
      const customer = decodeAs(CustomerDoc, raw)
      if (!customer.userId) continue
      const userDoc = yield* firestore.getDoc(`users/${customer.userId}`)
      if (!userDoc) continue
      // This is a best-effort cross-org sweep: a customer with no resolvable
      // birthDate (no user doc shape we can read) simply gets no reminder — one
      // unreadable record must not abort notifications for every other org.
      const parsed = Schema.decodeUnknownOption(UserBirthDateDoc)(userDoc)
      if (Option.isNone(parsed)) continue
      const { birthDate } = parsed.value
      if (!birthDate) continue

      const customerMonthDay = birthDate.slice(5)
      if (customerMonthDay !== monthDay) continue

      const { endUtc } = getOrgDayBoundsUtc(today, org.timezone)
      const eventKey = `birthday-${today}-customer-${customer.id}-unit-${unit.id}`

      const result = yield* createNotification({
        orgId: org.id,
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
  org: OrgDoc,
  unit: UnitDoc,
  today: string,
): Effect.Effect<number, EventValidationError, FirestoreService> {
  return Effect.gen(function* () {
    const firestore = yield* FirestoreService
    const subDocs = yield* firestore.getDocs(`orgs/${org.id}/subscriptions`, [
      { kind: 'where', field: 'status', op: 'in', value: ['active', 'past_due'] },
    ])
    let created = 0

    const tomorrow = shiftDateInOrgTz(today, 1, org.timezone)
    const yesterday = shiftDateInOrgTz(today, -1, org.timezone)
    const sevenDaysAgo = shiftDateInOrgTz(today, -7, org.timezone)

    for (const raw of subDocs) {
      const sub = decodeAs(SubscriptionDoc, raw)
      if (!sub.currentPeriod?.endAt) continue

      const endDate = toOrgTime(sub.currentPeriod.endAt, org.timezone).dateISO
      const touches = matchSubscriptionTouches(endDate, tomorrow, yesterday, sevenDaysAgo)

      for (const touch of touches) {
        const eventKey = `${touch.type}-sub-${sub.id}-unit-${unit.id}`
        const result = yield* createNotification({
          orgId: org.id,
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
