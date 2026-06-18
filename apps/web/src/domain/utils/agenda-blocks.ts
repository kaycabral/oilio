// Resolve agenda blocks (recurring + one-off) into concrete minute-interval
// segments for a given calendar day in a org's timezone.

import type { AgendaBlock } from '../types/agenda-block'
import { getWeekdayInOrgTz, hhmmToMinutes, type Weekday } from './business-hours'
import { toOrgTime } from './timezone'

// A resolved block segment, in minutes since 00:00 local on the target day.
export type BlockSegment = {
  blockId: string
  professionalId: string | null
  reason: string
  startMin: number
  endMin: number
}

function segmentOf(b: AgendaBlock, startMin: number, endMin: number): BlockSegment {
  return { blockId: b.id, professionalId: b.professionalId, reason: b.reason, startMin, endMin }
}

// Recurring block: emits a segment when its weekday matches the target day.
function resolveRecurring(b: AgendaBlock, weekday: Weekday): BlockSegment | null {
  if (b.kind !== 'recurring') return null
  if (b.weekday !== weekday) return null
  const startMin = hhmmToMinutes(b.open)
  const endMin = hhmmToMinutes(b.close)
  if (endMin <= startMin) return null
  return segmentOf(b, startMin, endMin)
}

// One-off block: intersect the [startAt, endAt] UTC interval with the day in tz.
function resolveOneOff(b: AgendaBlock, date: string, tz: string): BlockSegment | null {
  if (b.kind !== 'one_off') return null
  const startLocal = toOrgTime(b.startAt, tz)
  const endLocal = toOrgTime(b.endAt, tz)
  const startsOnDay = startLocal.dateISO === date
  const endsOnDay = endLocal.dateISO === date
  const spansDay = startLocal.dateISO < date && endLocal.dateISO > date
  if (!startsOnDay && !endsOnDay && !spansDay) return null
  const startMin = startsOnDay ? startLocal.hour * 60 + startLocal.minute : 0
  const endMin = endsOnDay ? endLocal.hour * 60 + endLocal.minute : 24 * 60
  if (endMin <= startMin) return null
  return segmentOf(b, startMin, endMin)
}

// Returns all block segments that intersect `date` (YYYY-MM-DD in tz) for the
// active unit. Segments are clipped to [0, 1440] minutes; the caller is
// responsible for further clipping to its visible grid window.
export function getBlockSegmentsForDay(
  blocks: readonly AgendaBlock[],
  date: string,
  tz: string,
): BlockSegment[] {
  const weekday = getWeekdayInOrgTz(date, tz)
  return blocks
    .map((b) => resolveRecurring(b, weekday) ?? resolveOneOff(b, date, tz))
    .filter((s): s is BlockSegment => s !== null)
}
