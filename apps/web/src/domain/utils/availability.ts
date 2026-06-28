// Public availability computation for the unit calendar (#842).
//
// Pure function — given a org's slot granularity, a unit's business hours,
// the appointments and blocks for the target day, and the memberOperations who
// execute the requested service at this unit, returns the per-memberOperation
// slot starts (ISO UTC) that are still bookable.
//
// Inputs are pre-filtered:
//   - `appointments` MUST already be scoped to the unit + day.
//   - `blocks` MUST already be scoped to the unit and resolved for the day
//      via `getBlockSegmentsForDay`.
//   - `memberOperations` MUST already be filtered via `memberOperationsForService`
//      (#876) — i.e., each entry both executes the service and operates at
//      the unit.
//
// Filtering responsibilities upstream keep this helper testable without
// re-implementing org scoping.

import type { Appointment } from '../types/appointment'
import type { CatalogServiceItem } from '../types/catalog-item'
import { resolveCatalogItemForUnit } from '../types/catalog-item'
import { isOperational } from '../types/enums'
import type { MemberOperation } from '../types/member-operation'
import type { BusinessHours } from '../types/unit'
import type { BlockSegment } from './agenda-blocks'
import { intervalsOverlap } from './appointment-overlap'
import { getBusinessHoursForDay, hhmmToMinutes, type Weekday } from './business-hours'
import { fromOrgTime, toOrgTime } from './timezone'

export type AvailabilitySlot = {
  memberOperationId: string
  // ISO UTC. The slot covers [startAt, startAt + resolvedDurationMinutes).
  startAt: string
}

export type ComputeAvailabilityInput = {
  service: CatalogServiceItem
  unitId: string
  memberOperations: readonly MemberOperation[]
  unitBusinessHours: BusinessHours | null
  appointments: readonly Appointment[]
  blockSegments: readonly BlockSegment[]
  // YYYY-MM-DD in org tz.
  date: string
  // Slot grid granularity (Org.slotMinutes — 5/10/15/30/60).
  slotMinutes: number
  timezone: string
  // Clock cutoff — slots strictly before this instant are dropped (UTC ms).
  // Defaults to Date.now() at call time; tests override for determinism.
  nowMs?: number
}

// Grid window for a day, in minutes-from-midnight (local). `null` = no bookable
// grid (closed, unconfigured, or zero/over-long service).
type DayWindow = { openMin: number; lastStartMin: number; duration: number }

// SPIKE (multi-interval): one window per open range of the day. A day can have
// split shifts (e.g. 09:00–12:00 and 14:00–18:00 with a lunch gap); each range
// becomes its own slot grid. Empty when closed/unconfigured or zero-duration.
function resolveDayWindows(input: ComputeAvailabilityInput): DayWindow[] {
  const ranges = getBusinessHoursForDay(input.unitBusinessHours, input.date, input.timezone)
  const duration = resolveCatalogItemForUnit(input.service, input.unitId).durationMinutes
  if (duration <= 0) return []
  const windows: DayWindow[] = []
  for (const r of ranges) {
    const openMin = hhmmToMinutes(r.open)
    // Slot start must end before close (half-open range).
    const lastStartMin = hhmmToMinutes(r.close) - duration
    if (lastStartMin >= openMin) windows.push({ openMin, lastStartMin, duration })
  }
  return windows
}

function isMemberOperationEligible(
  pro: ComputeAvailabilityInput['memberOperations'][number],
  unitId: string,
  serviceId: string,
): boolean {
  return (
    pro.unitIds.includes(unitId) &&
    isOperational(pro.operationalStatus) &&
    pro.catalogServiceIds.includes(serviceId)
  )
}

function slotsForMemberOperation(
  pro: ComputeAvailabilityInput['memberOperations'][number],
  windows: readonly DayWindow[],
  input: ComputeAvailabilityInput,
  nowMs: number,
): AvailabilitySlot[] {
  const { date, slotMinutes, timezone } = input
  const proAppointments = input.appointments.filter(
    (a) => a.memberOperationId === pro.id && a.status !== 'cancelled',
  )
  const proBlocks = input.blockSegments.filter(
    (b) => b.memberOperationId === null || b.memberOperationId === pro.id,
  )
  const slots: AvailabilitySlot[] = []
  for (const window of windows) {
    for (let m = window.openMin; m <= window.lastStartMin; m += slotMinutes) {
      const startUtcIso = fromOrgTime({ date, hour: Math.floor(m / 60), minute: m % 60 }, timezone)
      const startMs = new Date(startUtcIso).getTime()
      if (startMs < nowMs) continue
      const endUtcIso = new Date(startMs + window.duration * 60_000).toISOString()
      // Block segment spans [startMin, endMin); slot spans [m, m + duration).
      const blocked = proBlocks.some((b) => m < b.endMin && b.startMin < m + window.duration)
      if (blocked) continue
      const booked = proAppointments.some((a) =>
        intervalsOverlap({ startAt: startUtcIso, endAt: endUtcIso }, a),
      )
      if (booked) continue
      slots.push({ memberOperationId: pro.id, startAt: startUtcIso })
    }
  }
  return slots
}

export function computeAvailabilityForDay(input: ComputeAvailabilityInput): AvailabilitySlot[] {
  const windows = resolveDayWindows(input)
  if (windows.length === 0) return []
  const nowMs = input.nowMs ?? Date.now()
  return input.memberOperations
    .filter((pro) => isMemberOperationEligible(pro, input.unitId, input.service.id))
    .flatMap((pro) => slotsForMemberOperation(pro, windows, input, nowMs))
}

// Convenience: weekday key from a date string + tz (re-exported for callers
// that group availability by day).
export type AvailabilityWeekday = Weekday

// Group slots by their org-local clock time, so the UI can render a
// "10:00 → Alice, Bob" row even when the underlying appointments are stored
// in UTC. Returns a sorted list of `{ localHHmm, slots[] }` pairs.
export type AvailabilityRow = {
  localHHmm: string
  slots: AvailabilitySlot[]
}

export function groupAvailabilityByLocalTime(
  slots: readonly AvailabilitySlot[],
  timezone: string,
): AvailabilityRow[] {
  const byHHmm = new Map<string, AvailabilitySlot[]>()
  for (const s of slots) {
    const local = toOrgTime(s.startAt, timezone)
    const key = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
    const list = byHHmm.get(key) ?? []
    list.push(s)
    byHHmm.set(key, list)
  }
  return Array.from(byHHmm.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([localHHmm, list]) => ({ localHHmm, slots: list }))
}
