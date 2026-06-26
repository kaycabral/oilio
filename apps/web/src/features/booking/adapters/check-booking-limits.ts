import { Appointment, type BookingLimits } from '@/domain'
import {
  evaluateBookingLimits,
  type BookingLimitsCheck,
} from '@/features/booking/core/booking-limits'
import {
  rowToDoc as apptRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

// Re-exported so existing consumers keep importing the type from here.
export type { BookingLimitsCheck }

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

// Read all of a customer's appointments within one org (brief 0061 § Grupo C /
// AC-04). A customer's appointments may span units, so the query is org-wide (no
// `app.current_unit` pin); reads the typed table under RLS.
async function loadCustomerAppointments(orgId: string, customerId: string): Promise<Appointment[]> {
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>('SELECT * FROM appointments WHERE org_id = $1 AND customer_id = $2', [
        orgId,
        customerId,
      ])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeAppointment(apptRowToDoc(r)))
}

// Imperative shell: the single per-customer fetch, then delegate the decision to
// the pure core. maxPerDay needs the same-day rows; requireComplete + maxConcurrent
// need the future rows — one bounded per-customer query satisfies both (a
// future-only filter would still need a composite index; simple is fine for V0).
export async function checkBookingLimits(args: {
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
  const customerAppointments = await loadCustomerAppointments(args.orgId, args.customerId)
  const appointments = customerAppointments.filter((a) => a.id !== args.excludeAppointmentId)

  return evaluateBookingLimits({
    appointments,
    limits: args.limits,
    proposedStartAt: args.proposedStartAt,
    orgTimezone: args.orgTimezone,
    now: args.now ?? new Date(),
  })
}
