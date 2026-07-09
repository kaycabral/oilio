import type { AllowedTimeScope } from '../types/subscription-plan'
import { hhmmToMinutes } from './business-hours'
import { toOrgTime } from './timezone'

const HHMM_RE = /^(\d{2}):(\d{2})$/

export function isValidTimeScopeHHmm(s: string): boolean {
  const m = HHMM_RE.exec(s)
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59
}

export function isDayOfWeekAllowed(
  daysOfWeek: readonly number[] | undefined,
  utcIso: string,
  tz: string,
): boolean {
  if (!daysOfWeek || daysOfWeek.length === 0) return true
  const { dateISO } = toOrgTime(utcIso, tz)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!m) return false
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return daysOfWeek.includes(day)
}

export function isHourRangeAllowed(
  hourRange: AllowedTimeScope['hourRange'] | undefined,
  utcIso: string,
  tz: string,
): boolean {
  if (!hourRange) return true
  const start = hhmmToMinutes(hourRange.start)
  const end = hhmmToMinutes(hourRange.end)
  if (end <= start) return false
  const { hour, minute } = toOrgTime(utcIso, tz)
  const slotMinutes = hour * 60 + minute
  return slotMinutes >= start && slotMinutes < end
}

export function isAdvanceBookingAllowed(
  advanceBookingDays: number | undefined,
  todayISO: string,
  dateISO: string,
): boolean {
  if (advanceBookingDays == null || advanceBookingDays <= 0) return true
  const today = parseLocalDate(todayISO)
  const target = parseLocalDate(dateISO)
  if (!today || !target) return true
  const diffDays = Math.floor((target - today) / 86_400_000)
  return diffDays <= advanceBookingDays
}

function parseLocalDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function isInstantWithinTimeScope(
  scope: AllowedTimeScope | null | undefined,
  utcIso: string,
  tz: string,
  todayISO: string,
): boolean {
  if (!scope) return true
  if (!isDayOfWeekAllowed(scope.daysOfWeek, utcIso, tz)) return false
  if (!isHourRangeAllowed(scope.hourRange, utcIso, tz)) return false
  const { dateISO } = toOrgTime(utcIso, tz)
  if (!isAdvanceBookingAllowed(scope.advanceBookingDays, todayISO, dateISO)) {
    return false
  }
  return true
}

export function mergeAllowedTimeScopes(
  a: AllowedTimeScope | null | undefined,
  b: AllowedTimeScope | null | undefined,
): AllowedTimeScope | null {
  if (!a && !b) return null
  if (!a) return b ?? null
  if (!b) return a ?? null

  const out: AllowedTimeScope = {}

  if (a.daysOfWeek != null && b.daysOfWeek != null) {
    const merged = Array.from(new Set([...a.daysOfWeek, ...b.daysOfWeek])).sort((x, y) => x - y)
    if (merged.length > 0 && merged.length < 7) out.daysOfWeek = merged
  }

  if (a.hourRange != null && b.hourRange != null) {
    const start = minHHmm(a.hourRange.start, b.hourRange.start)
    const end = maxHHmm(a.hourRange.end, b.hourRange.end)
    out.hourRange = { start, end }
  }

  if (a.advanceBookingDays != null && b.advanceBookingDays != null) {
    out.advanceBookingDays = Math.max(a.advanceBookingDays, b.advanceBookingDays)
  }

  if (out.daysOfWeek == null && out.hourRange == null && out.advanceBookingDays == null) {
    return null
  }
  return out
}

function minHHmm(a: string, b: string): string {
  return hhmmToMinutes(a) <= hhmmToMinutes(b) ? a : b
}

function maxHHmm(a: string, b: string): string {
  return hhmmToMinutes(a) >= hhmmToMinutes(b) ? a : b
}
