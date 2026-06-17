// Business hours helpers for the tenant-aware agenda.
//
// `BusinessHours` lives on `Unit` (one map per weekday). A `null` for a weekday
// means "closed that day". A `null` for the whole `Unit.businessHours` means
// "not configured" — render layer treats that as no constraint.

import { type BusinessHours, type HoursRange, dayHoursToRanges } from '../types/unit'
import { toTenantTime } from './timezone'

export type Weekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'

// Index matches JavaScript's `Date.getDay()` (0 = Sunday).
export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const satisfies readonly Weekday[]

const HHMM_RE = /^(\d{2}):(\d{2})$/

export function isValidHHmm(s: string): boolean {
  const m = HHMM_RE.exec(s)
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59
}

export function hhmmToMinutes(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm)
  if (!m) throw new Error(`Invalid HH:mm: ${hhmm}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new Error(`Invalid HH:mm: ${hhmm}`)
  return h * 60 + min
}

export function minutesToHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Weekday of `date` (YYYY-MM-DD) interpreted as a calendar day in tenant `tz`.
// Uses noon UTC of the date as the canonical instant for weekday lookup — noon
// is far from any DST/midnight edge so the weekday is unambiguous regardless of
// tz.
export function getWeekdayInTenantTz(date: string, tz: string): Weekday {
  const noonUtc = `${date}T12:00:00.000Z`
  const { dateISO } = toTenantTime(noonUtc, tz)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!m) throw new Error(`Unexpected tenant date format: ${dateISO}`)
  // Date.UTC then .getUTCDay() gives weekday without local-tz drift.
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  const wd = WEEKDAYS[day]
  if (!wd) throw new Error(`Invalid weekday index ${day}`)
  return wd
}

// Returns the open windows for the date's weekday as a flat list (empty when
// the unit is closed that weekday or hours aren't configured). Normalizes the
// legacy single-range / null shape and the multi-interval array shape.
export function getBusinessHoursForDay(
  businessHours: BusinessHours | null,
  date: string,
  tz: string,
): HoursRange[] {
  if (!businessHours) return []
  const weekday = getWeekdayInTenantTz(date, tz)
  return dayHoursToRanges(businessHours[weekday])
}

export function isBusinessHoursConfigured(bh: BusinessHours | null): bh is BusinessHours {
  return bh !== null
}

// Validates a HoursRange has open < close and both are HH:mm. Returns null when
// valid; otherwise an error message in pt-BR.
export function validateHoursRange(range: HoursRange): string | null {
  if (!isValidHHmm(range.open)) return 'Horário de abertura inválido'
  if (!isValidHHmm(range.close)) return 'Horário de fechamento inválido'
  if (hhmmToMinutes(range.open) >= hhmmToMinutes(range.close)) {
    return 'Abertura deve ser antes do fechamento'
  }
  return null
}
