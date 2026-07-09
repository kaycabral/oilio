import type { AgendaBlock } from '../types/agenda-block'
import { getWeekdayInOrgTz, hhmmToMinutes, type Weekday } from './business-hours'
import { toOrgTime } from './timezone'

export type BlockSegment = {
  blockId: string
  memberOperationId: string | null
  reason: string
  startMin: number
  endMin: number
}

function segmentOf(b: AgendaBlock, startMin: number, endMin: number): BlockSegment {
  return {
    blockId: b.id,
    memberOperationId: b.memberOperationId,
    reason: b.reason,
    startMin,
    endMin,
  }
}

function resolveRecurring(b: AgendaBlock, weekday: Weekday): BlockSegment | null {
  if (b.kind !== 'recurring') return null
  if (b.weekday !== weekday) return null
  const startMin = hhmmToMinutes(b.open)
  const endMin = hhmmToMinutes(b.close)
  if (endMin <= startMin) return null
  return segmentOf(b, startMin, endMin)
}

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
