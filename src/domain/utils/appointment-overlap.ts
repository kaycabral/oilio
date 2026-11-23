import type { BlockSegment } from './agenda-blocks'
import { toOrgTime } from './timezone'

export type AppointmentInterval = {
  startAt: string
  endAt: string
}

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
  const endMin = proposedEnd.dateISO === date ? proposedEnd.hour * 60 + proposedEnd.minute : 1440

  return blockSegments
    .filter(
      (seg) =>
        (seg.memberOperationId === null || seg.memberOperationId === memberOperationId) &&
        startMin < seg.endMin &&
        seg.startMin < endMin,
    )
    .map((seg) => ({ kind: 'block', blockId: seg.blockId, reason: seg.reason }))
}

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
