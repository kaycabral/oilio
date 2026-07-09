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

export type { BookingLimitsCheck }

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

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

export async function checkBookingLimits(args: {
  orgId: string
  orgTimezone: string
  customerId: string
  limits: BookingLimits
  proposedStartAt: string
  now?: Date
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
