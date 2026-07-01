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
  // The booked service's duration in minutes — the appointment must END within
  // the open range (`start + duration <= close`), mirroring the availability
  // generator's `lastStartMin = close - duration`. A non-positive duration is a
  // misconfiguration → no valid slot.
  durationMinutes: number
  // The unit's business hours (one map per weekday), or null when unconfigured.
  businessHours: BusinessHours | null
  // Org IANA timezone — the grid is anchored to org-local clock time.
  timezone: string
  // Optional cutoff (UTC ms): a `startAt` strictly before this is rejected as
  // past — same guard the availability generator applies (`startMs < nowMs`).
  // Omitted = no past-time check (callers that already gate elsewhere).
  nowMs?: number
}

// True when `startAt` lands exactly on a slot of the configured grid AND the
// whole appointment (`start + duration`) fits inside one open business-hours
// range for that weekday. The grid for each open range starts at the range's
// open time and steps by `slotMinutes`; a `startAt` is valid only when it
// coincides with one of those steps, opens no earlier than the range open, and
// ends no later than the range close.
//
// `slotMinutes <= 0` / `durationMinutes <= 0` are misconfigurations — treated as
// "no valid slot". Unconfigured/closed days (no ranges) reject every `startAt`.
// When `nowMs` is provided, a start before it is rejected (past slot).
export function isStartAtOnGrid(input: SlotGridInput): boolean {
  if (input.slotMinutes <= 0 || input.durationMinutes <= 0) return false
  const startMs = new Date(input.startAt).getTime()
  if (!Number.isFinite(startMs)) return false
  // A slot start is minute-aligned by construction (`fromOrgTime` emits no
  // sub-minute component). A forged `startAt` carrying seconds/ms is off the
  // grid regardless of its clock minute — reject before the modulo check.
  if (startMs % 60_000 !== 0) return false
  if (input.nowMs !== undefined && startMs < input.nowMs) return false

  const local = toOrgTime(input.startAt, input.timezone)
  const startMin = local.hour * 60 + local.minute
  const endMin = startMin + input.durationMinutes

  const ranges = getBusinessHoursForDay(input.businessHours, local.dateISO, input.timezone)
  for (const range of ranges) {
    const openMin = hhmmToMinutes(range.open)
    const closeMin = hhmmToMinutes(range.close)
    // Slot must open at/after the range open and END at/before the range close.
    if (startMin < openMin || endMin > closeMin) continue
    if ((startMin - openMin) % input.slotMinutes === 0) return true
  }
  return false
}
