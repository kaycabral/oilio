// Slot-grid validation for the appointment write path (brief 0080).
//
// `computeAvailabilityForDay` (availability.ts) generates the bookable slots a
// surface *offers*; this predicate answers the dual question on the *write*
// path: "is this `startAt` a real slot of the configured grid, inside business
// hours?". It is the server-side invariant that makes the three booking
// surfaces (self-book, reception create, reception edit) reject an `startAt`
// off the grid — including a forged POST — independently of the client.
//
// Pure (domain): no I/O. Callers resolve `slotMinutes` (unitSlotMinutes) and
// `businessHours` from the unit's agenda and pass the UTC `startAt`.

import type { BusinessHours } from '../types/unit'
import { getBusinessHoursForDay, hhmmToMinutes } from './business-hours'
import { toOrgTime } from './timezone'

export type SlotGridInput = {
  // The candidate appointment start, ISO UTC.
  startAt: string
  // Slot grid granularity (Org/Unit slotMinutes — 5/10/15/30/60).
  slotMinutes: number
  // The unit's business hours (one map per weekday), or null when unconfigured.
  businessHours: BusinessHours | null
  // Org IANA timezone — the grid is anchored to org-local clock time.
  timezone: string
}

// True when `startAt` lands exactly on a slot of the configured grid AND inside
// an open business-hours range for that weekday. The grid for each open range
// starts at the range's open time and steps by `slotMinutes`; a `startAt` is
// valid only when it coincides with one of those steps and is strictly before
// the range close (a slot must start within the open window).
//
// `slotMinutes <= 0` is a misconfiguration — treated as "no valid slot" rather
// than dividing by zero. Unconfigured/closed days (no ranges) reject every
// `startAt` for that day.
export function isStartAtOnGrid(input: SlotGridInput): boolean {
  if (input.slotMinutes <= 0) return false
  const startMs = new Date(input.startAt).getTime()
  if (!Number.isFinite(startMs)) return false
  // A slot start is minute-aligned by construction (`fromOrgTime` emits no
  // sub-minute component). A forged `startAt` carrying seconds/ms is off the
  // grid regardless of its clock minute — reject before the modulo check.
  if (startMs % 60_000 !== 0) return false

  const local = toOrgTime(input.startAt, input.timezone)
  const startMin = local.hour * 60 + local.minute

  const ranges = getBusinessHoursForDay(input.businessHours, local.dateISO, input.timezone)
  for (const range of ranges) {
    const openMin = hhmmToMinutes(range.open)
    const closeMin = hhmmToMinutes(range.close)
    if (startMin < openMin || startMin >= closeMin) continue
    if ((startMin - openMin) % input.slotMinutes === 0) return true
  }
  return false
}
