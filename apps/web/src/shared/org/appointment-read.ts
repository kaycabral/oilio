import { Appointment } from '@/domain'
import {
  type AppointmentRow,
  rowToDoc as appointmentRowToDoc,
} from '@/shared/db/pg/effect/appointment-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

// Reads for the `appointment` projection (brief 0061 § Grupo C / AC-04): reads
// the typed `appointments` table under RLS. Org-wide (no unit pin) — the offboard
// cascade looks up a memberOperation's appointments across the org's units.

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

// A single appointment by id. Returns null when absent. Reads the typed
// `appointments` table under RLS (org-scoped — no unit pin: the staff
// transitions/start-attendance flows address an appointment by id directly).
export async function getAppointmentById(
  orgId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>('SELECT * FROM appointments WHERE org_id = $1 AND id = $2', [
        orgId,
        appointmentId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeAppointment(appointmentRowToDoc(row)) : null
}

// Every appointment of a unit whose `startAt` falls within `[startUtc, endUtc]`
// (ISO text, inclusive) — the self-book availability read for one day. Pins
// `app.current_unit` for the unit-scoped policy; `start_at` is ISO text so the
// range compares lexicographically (UTC instants), matching the Firestore
// `>=`/`<=` range query.
export async function listUnitAppointmentsInRange(
  orgId: string,
  unitId: string,
  range: { startUtc: string; endUtc: string },
  // Own-scope (brief 0075, #1256): pass a memberOperation's id to restrict the read
  // to THEIR appointments via the `app.current_member_operation` RLS predicate; `''`
  // (the balcão) reads the whole unit. The SQL is unchanged — the database
  // narrows the rows, so a memberOperation can't read a colleague's day.
  memberOperationId = '',
): Promise<Appointment[]> {
  const { startUtc, endUtc } = range
  const rows = await readUnderRls<AppointmentRow>(
    orgId,
    (client) =>
      client
        .query<AppointmentRow>(
          `SELECT * FROM appointments
             WHERE org_id = $1 AND unit_id = $2 AND start_at >= $3 AND start_at <= $4`,
          [orgId, unitId, startUtc, endUtc],
        )
        .then((res) => res.rows),
    unitId,
    memberOperationId,
  )
  return rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))
}

// Every appointment owned by a memberOperation in an org (any status). The caller
// filters the future/scheduled subset — kept org-wide (no `app.current_unit`
// pin) because a memberOperation may serve multiple units.
export async function listAppointmentsByMemberOperationId(
  orgId: string,
  memberOperationId: string,
): Promise<Appointment[]> {
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>(
        'SELECT * FROM appointments WHERE org_id = $1 AND member_operation_id = $2',
        [orgId, memberOperationId],
      )
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))
}
