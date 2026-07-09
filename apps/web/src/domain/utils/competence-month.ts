import { toOrgTime } from '@/domain/utils/timezone'

export type CompetenceMonth = {
  readonly month: string
  readonly startUtc: string
}

export function toOrgMonth(utcIso: string, tz: string): string {
  return toOrgTime(utcIso, tz).dateISO.slice(0, 7)
}

export function firstInstantOfMonthUtc(month: string, tz: string): string {
  const [year, mon] = splitMonth(month)
  const naiveIso = `${month}-01T00:00:00.000Z`
  const offsetMinutes = orgOffsetMinutes(naiveIso, tz)
  const utcMs = Date.UTC(year, mon - 1, 1) - offsetMinutes * 60_000
  return new Date(utcMs).toISOString()
}

export function enumerateCompetenceMonths(
  fromIso: string,
  toIso: string,
  tz: string,
): CompetenceMonth[] {
  const fromMonth = toOrgMonth(fromIso, tz)
  const toMonth = toOrgMonth(toIso, tz)
  if (fromMonth > toMonth) return []

  const months: CompetenceMonth[] = []
  let cursor = fromMonth
  while (cursor <= toMonth) {
    const startUtc = firstInstantOfMonthUtc(cursor, tz)
    if (startUtc < toIso) months.push({ month: cursor, startUtc })
    cursor = nextMonth(cursor)
  }
  return months
}

export function overlapsWindow(
  effectiveFrom: string,
  effectiveTo: string | null,
  month: string,
  tz: string,
): boolean {
  if (toOrgMonth(effectiveFrom, tz) > month) return false
  if (effectiveTo !== null && toOrgMonth(effectiveTo, tz) <= month) return false
  return true
}

function orgOffsetMinutes(utcIso: string, tz: string): number {
  const asUtc = new Date(utcIso)
  const local = toOrgTime(utcIso, tz)
  const parts = local.dateISO.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  const asLocalMs = Date.UTC(y, m - 1, d, local.hour, local.minute)
  return Math.round((asLocalMs - asUtc.getTime()) / 60_000)
}

function splitMonth(month: string): [number, number] {
  const parts = month.split('-')
  return [Number(parts[0]), Number(parts[1])]
}

export function nextMonth(month: string): string {
  const [year, mon] = splitMonth(month)
  const nextYear = mon === 12 ? year + 1 : year
  const nextMon = mon === 12 ? 1 : mon + 1
  return `${String(nextYear).padStart(4, '0')}-${String(nextMon).padStart(2, '0')}`
}
