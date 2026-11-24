import { Appointment } from '@/domain'
import {
  type AppointmentRow,
  rowToDoc as appointmentRowToDoc,
} from '@/shared/db/pg/effect/appointment-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)

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

export async function listUnitAppointmentsInRange(
  orgId: string,
  unitId: string,
  range: { startUtc: string; endUtc: string },
  options: {
    memberOperationId?: string
    includeCancelled?: boolean
  } = {},
): Promise<Appointment[]> {
  const { memberOperationId = '', includeCancelled = false } = options
  const { startUtc, endUtc } = range
  const statusFilter = includeCancelled ? '' : ` AND status <> 'cancelled'`
  const rows = await readUnderRls<AppointmentRow>(
    orgId,
    (client) =>
      client
        .query<AppointmentRow>(
          `SELECT * FROM appointments
             WHERE org_id = $1 AND unit_id = $2 AND start_at >= $3 AND start_at <= $4${statusFilter}`,
          [orgId, unitId, startUtc, endUtc],
        )
        .then((res) => res.rows),
    unitId,
    memberOperationId,
  )
  return rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))
}

export async function listMemberOperationAppointmentsInRange(
  orgId: string,
  memberOperationId: string,
  range: { startUtc: string; endUtc: string },
): Promise<Appointment[]> {
  const { startUtc, endUtc } = range
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>(
        `SELECT * FROM appointments
           WHERE org_id = $1 AND member_operation_id = $2
             AND start_at >= $3 AND start_at <= $4 AND status <> 'cancelled'`,
        [orgId, memberOperationId, startUtc, endUtc],
      )
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))
}

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
