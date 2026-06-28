// Conflict detection for a new/edited appointment against existing appointments
// and agenda blocks. Operates on ISO-UTC instants — callers convert org-local
// inputs to UTC before calling.
//
// Semantics: half-open intervals [start, end). Two intervals overlap when
// `a.start < b.end && b.start < a.end`. Equal boundaries (back-to-back) DO NOT
// overlap — booking at 10:00 right after a 09:00–10:00 appointment is allowed.

import type { BlockSegment } from './agenda-blocks'
import { toOrgTime } from './timezone'

export type AppointmentInterval = {
  startAt: string
  endAt: string
}

// The minimal projection of an existing appointment overlap detection needs —
// a full `Appointment` is structurally assignable. Keeping the contract narrow
// lets callers decode only these fields at the read boundary.
export type AppointmentForOverlap = {
  readonly id: string
  readonly memberOperationId: string
  readonly startAt: string
  readonly endAt: string
  readonly status: string
}

export function intervalsOverlap(a: AppointmentInterval, b: AppointmentInterval): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

export type AppointmentConflict =
  | { kind: 'appointment'; appointmentId: string }
  | { kind: 'block'; blockId: string; reason: string }

function appointmentConflicts(
  proposed: AppointmentInterval,
  memberOperationId: string,
  existing: readonly AppointmentForOverlap[],
  excludeAppointmentId: string | null | undefined,
): AppointmentConflict[] {
  return existing
    .filter(
      (a) =>
        a.status !== 'cancelled' &&
        a.memberOperationId === memberOperationId &&
        !(excludeAppointmentId && a.id === excludeAppointmentId) &&
        intervalsOverlap(proposed, a),
    )
    .map((a) => ({ kind: 'appointment', appointmentId: a.id }))
}

function blockConflicts({
  proposed,
  memberOperationId,
  blockSegments,
  date,
  tz,
}: {
  proposed: AppointmentInterval
  memberOperationId: string
  blockSegments: readonly BlockSegment[]
  date: string
  tz: string
}): AppointmentConflict[] {
  const proposedStart = toOrgTime(proposed.startAt, tz)
  if (proposedStart.dateISO !== date) return []
  const proposedEnd = toOrgTime(proposed.endAt, tz)
  const startMin = proposedStart.hour * 60 + proposedStart.minute
  // If the proposed interval crosses midnight, clip at 1440 — anything past
  // belongs to the next day and is handled by that day's segments.
  const endMin = proposedEnd.dateISO === date ? proposedEnd.hour * 60 + proposedEnd.minute : 1440

  // Block segments are minutes-from-midnight on the target date. A segment
  // conflicts when it overlaps [startMin, endMin) and applies to this
  // memberOperation (unit-wide or matching id).
  return blockSegments
    .filter(
      (seg) =>
        (seg.memberOperationId === null || seg.memberOperationId === memberOperationId) &&
        startMin < seg.endMin &&
        seg.startMin < endMin,
    )
    .map((seg) => ({ kind: 'block', blockId: seg.blockId, reason: seg.reason }))
}

// Finds appointments and blocks that overlap the proposed interval for a given
// memberOperation on a given local day. Cancelled appointments are ignored.
//
// - `existing` should be pre-filtered to the same unit + memberOperation + day.
// - `blockSegments` are already resolved for the day in org tz.
// - `excludeAppointmentId` skips a specific appointment id (for edit flows).
export function findAppointmentConflicts({
  proposed,
  memberOperationId,
  existing,
  blockSegments,
  date,
  tz,
  excludeAppointmentId,
}: {
  proposed: AppointmentInterval
  memberOperationId: string
  existing: readonly AppointmentForOverlap[]
  blockSegments: readonly BlockSegment[]
  date: string
  tz: string
  excludeAppointmentId?: string | null
}): AppointmentConflict[] {
  return [
    ...appointmentConflicts(proposed, memberOperationId, existing, excludeAppointmentId),
    ...blockConflicts({ proposed, memberOperationId, blockSegments, date, tz }),
  ]
}
