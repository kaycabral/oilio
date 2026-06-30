// Business hours helpers for the org-aware agenda.
//
// `BusinessHours` lives on `Unit` (one map per weekday). A `null` for a weekday
// means "closed that day". A `null` for the whole `Unit.businessHours` means
// "not configured" — render layer treats that as no constraint.

import {
  type BusinessHours,
  type HoursRange,
  type Unit,
  type UnitAgendaConfig,
  dayHoursToRanges,
  isAddressComplete,
  isUnitBookable,
  unitBusinessHours,
} from '../types/unit'
import { toOrgTime } from './timezone'

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

// Weekday of `date` (YYYY-MM-DD) interpreted as a calendar day in org `tz`.
// Uses noon UTC of the date as the canonical instant for weekday lookup — noon
// is far from any DST/midnight edge so the weekday is unambiguous regardless of
// tz.
export function getWeekdayInOrgTz(date: string, tz: string): Weekday {
  const noonUtc = `${date}T12:00:00.000Z`
  const { dateISO } = toOrgTime(noonUtc, tz)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!m) throw new Error(`Unexpected org date format: ${dateISO}`)
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
  const weekday = getWeekdayInOrgTz(date, tz)
  return dayHoursToRanges(businessHours[weekday])
}

// Whether a unit has any operating hours configured. v2 (PRD Identidade): the
// `Unit.agenda` union always carries a `businessHours` object for fixed/
// appointment modes (never null), so "not configured" is no longer `null` —
// it's an all-closed week (every weekday empty), the `EMPTY_BUSINESS_HOURS`
// zero-value a just-seeded/under-configured unit holds. A unit counts as having
// hours only when at least one weekday declares a range.
export function isBusinessHoursConfigured(bh: BusinessHours | null): bh is BusinessHours {
  if (bh === null) return false
  return WEEKDAYS.some((day) => dayHoursToRanges(bh[day]).length > 0)
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

// A unit has usable hours when it's `always_open` (open by definition) or its
// agenda carries at least one open weekday. The agenda always holds a
// `businessHours` object (never null), so the zero-value all-closed week
// (`EMPTY_BUSINESS_HOURS`) must NOT count as configured — defer to
// `isBusinessHoursConfigured`. These publish-readiness predicates live here (not
// in `types/unit`) so the types module never imports this util — keeps the
// dependency one-directional (util → types).
export function unitHasUsableHours(agenda: UnitAgendaConfig): boolean {
  return agenda.mode === 'always_open' || isBusinessHoursConfigured(unitBusinessHours(agenda))
}

// A unit has the address + hours a public page requires. The address schema
// tolerates empty strings (the aggregate's zero-value `EMPTY_ADDRESS`), so a unit
// seeded/built without an address would otherwise slip through as "ready" with a
// blank address — validate it for real via `isAddressComplete`.
export function unitHasAddressAndHours(unit: Pick<Unit, 'address' | 'agenda'>): boolean {
  return isAddressComplete(unit.address) && unitHasUsableHours(unit.agenda)
}

// Whether a unit's public booking page is live. SPIKE (inferred availability):
// there is no stored publish flag / publish button — a unit goes public the
// moment it uses the online agenda (appointment mode) AND has a complete address
// + operating hours. This is the SINGLE source of truth for "publicly live",
// shared by the landing/slots, the client invite, the booking wizard and the
// `public_visible` projection. Service/memberOperation readiness is owner-facing
// FEEDBACK only and does NOT hard-gate the public page (an appointment unit with
// hours but no pro simply renders no bookable slots). PRD Identidade v2.
export function isUnitPubliclyLive(unit: Pick<Unit, 'address' | 'agenda'>): boolean {
  return isUnitBookable(unit) && unitHasAddressAndHours(unit)
}
