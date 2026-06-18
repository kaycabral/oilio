import { Appointment, type BookingLimits } from '@/domain'
import {
  evaluateBookingLimits,
  type BookingLimitsCheck,
} from '@/features/booking/core/booking-limits'
import { fsConverter } from '@/shared/db/converter'
import type { Firestore } from 'firebase-admin/firestore'
import 'server-only'

// Re-exported so existing consumers keep importing the type from here.
export type { BookingLimitsCheck }

// Imperative shell: the single per-customer fetch, then delegate the decision to
// the pure core. maxPerDay needs the same-day rows; requireComplete + maxConcurrent
// need the future rows — one bounded per-customer query satisfies both (a
// future-only filter would still need a composite index; simple is fine for V0).
export async function checkBookingLimits(args: {
  db: Firestore
  orgId: string
  orgTimezone: string
  customerId: string
  limits: BookingLimits
  proposedStartAt: string
  now?: Date
  // Reschedule path needs to discount the appointment being moved — otherwise
  // the customer's own appointment counts against them.
  excludeAppointmentId?: string
}): Promise<BookingLimitsCheck> {
  const orgRef = args.db.collection('orgs').doc(args.orgId)
  const customerAptsSnap = await orgRef
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .where('customerId', '==', args.customerId)
    .get()
  const appointments = customerAptsSnap.docs
    .map((d) => d.data())
    .filter((a) => a.id !== args.excludeAppointmentId)

  return evaluateBookingLimits({
    appointments,
    limits: args.limits,
    proposedStartAt: args.proposedStartAt,
    orgTimezone: args.orgTimezone,
    now: args.now ?? new Date(),
  })
}
