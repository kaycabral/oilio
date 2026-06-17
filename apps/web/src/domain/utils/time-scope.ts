// Temporal scope helpers for Subscription plan rules (brief 0019, Group B).
//
// Pure functions only — no Firestore dep. The Firestore-bound resolver lives
// in `apps/oilio/web/src/lib/public/subscription-scope.ts` and composes
// these helpers across the customer's active subscriptions.
//
// Semantics:
//   - `undefined` (or sub-field undefined) = no restriction on that axis.
//   - Union across multiple scopes follows "most permissive wins":
//       * daysOfWeek: union of allowed days
//       * advanceBookingDays: max window
//       * hourRange: widest envelope [min(start), max(end))
//       * any unrestricted axis on any input collapses that axis to `undefined`.

import type { AllowedTimeScope } from '../types/subscription-plan'
import { hhmmToMinutes } from './business-hours'
import { toTenantTime } from './timezone'

const HHMM_RE = /^(\d{2}):(\d{2})$/

export function isValidTimeScopeHHmm(s: string): boolean {
  const m = HHMM_RE.exec(s)
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59
}

// Whether a `daysOfWeek` filter (0-6, Sun-Sat) admits the given UTC date
// interpreted in tenant tz. `undefined` filter = admit all.
export function isDayOfWeekAllowed(
  daysOfWeek: readonly number[] | undefined,
  utcIso: string,
  tz: string,
): boolean {
  if (!daysOfWeek || daysOfWeek.length === 0) return true
  const { dateISO } = toTenantTime(utcIso, tz)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!m) return false
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return daysOfWeek.includes(day)
}

// Whether the hour-range filter admits the local time of `utcIso` in `tz`.
// Inclusive start, exclusive end — matches business-hours semantics.
export function isHourRangeAllowed(
  hourRange: AllowedTimeScope['hourRange'] | undefined,
  utcIso: string,
  tz: string,
): boolean {
  if (!hourRange) return true
  const start = hhmmToMinutes(hourRange.start)
  const end = hhmmToMinutes(hourRange.end)
  if (end <= start) return false
  const { hour, minute } = toTenantTime(utcIso, tz)
  const slotMinutes = hour * 60 + minute
  return slotMinutes >= start && slotMinutes < end
}

// Whether `dateISO` (YYYY-MM-DD in tenant tz) is within the advance booking
// window measured from `todayISO` (also in tenant tz). `undefined` = no cap.
// `advanceBookingDays = 0` is treated as unrestricted (the form parser
// collapses 0 to undefined upstream).
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

// All-axes check used by both UI (availability filter) and server
// (commitAppointment defense-in-depth). `null` scope = unrestricted.
export function isInstantWithinTimeScope(
  scope: AllowedTimeScope | null | undefined,
  utcIso: string,
  tz: string,
  todayISO: string,
): boolean {
  if (!scope) return true
  if (!isDayOfWeekAllowed(scope.daysOfWeek, utcIso, tz)) return false
  if (!isHourRangeAllowed(scope.hourRange, utcIso, tz)) return false
  const { dateISO } = toTenantTime(utcIso, tz)
  if (!isAdvanceBookingAllowed(scope.advanceBookingDays, todayISO, dateISO)) {
    return false
  }
  return true
}

// Merge two scopes into "most permissive" union (AC-04 spec, extended to
// Group B). Returns `null` when either input is unrestricted on every axis
// or any axis collapses to unrestricted via union.
export function mergeAllowedTimeScopes(
  a: AllowedTimeScope | null | undefined,
  b: AllowedTimeScope | null | undefined,
): AllowedTimeScope | null {
  if (!a && !b) return null
  if (!a) return b ?? null
  if (!b) return a ?? null

  const out: AllowedTimeScope = {}

  // daysOfWeek: union; either undefined collapses to unrestricted.
  if (a.daysOfWeek == null || b.daysOfWeek == null) {
    // unrestricted axis
  } else {
    const merged = Array.from(new Set([...a.daysOfWeek, ...b.daysOfWeek])).sort((x, y) => x - y)
    if (merged.length > 0 && merged.length < 7) out.daysOfWeek = merged
  }

  // hourRange: widest envelope; either undefined collapses to unrestricted.
  if (a.hourRange == null || b.hourRange == null) {
    // unrestricted axis
  } else {
    const start = minHHmm(a.hourRange.start, b.hourRange.start)
    const end = maxHHmm(a.hourRange.end, b.hourRange.end)
    out.hourRange = { start, end }
  }

  // advanceBookingDays: max window; either undefined collapses to unrestricted.
  if (a.advanceBookingDays == null || b.advanceBookingDays == null) {
    // unrestricted axis
  } else {
    out.advanceBookingDays = Math.max(a.advanceBookingDays, b.advanceBookingDays)
  }

  // If every axis collapsed to unrestricted, return null (callers treat
  // null === unrestricted, matching the avulso path).
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
