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

export function getWeekdayInOrgTz(date: string, tz: string): Weekday {
  const noonUtc = `${date}T12:00:00.000Z`
  const { dateISO } = toOrgTime(noonUtc, tz)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!m) throw new Error(`Unexpected org date format: ${dateISO}`)
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  const wd = WEEKDAYS[day]
  if (!wd) throw new Error(`Invalid weekday index ${day}`)
  return wd
}

export function getBusinessHoursForDay(
  businessHours: BusinessHours | null,
  date: string,
  tz: string,
): HoursRange[] {
  if (!businessHours) return []
  const weekday = getWeekdayInOrgTz(date, tz)
  return dayHoursToRanges(businessHours[weekday])
}

export function isBusinessHoursConfigured(bh: BusinessHours | null): bh is BusinessHours {
  if (bh === null) return false
  return WEEKDAYS.some((day) => dayHoursToRanges(bh[day]).length > 0)
}

export function validateHoursRange(range: HoursRange): string | null {
  if (!isValidHHmm(range.open)) return 'Horário de abertura inválido'
  if (!isValidHHmm(range.close)) return 'Horário de fechamento inválido'
  if (hhmmToMinutes(range.open) >= hhmmToMinutes(range.close)) {
    return 'Abertura deve ser antes do fechamento'
  }
  return null
}

export function unitHasUsableHours(agenda: UnitAgendaConfig): boolean {
  return agenda.mode === 'always_open' || isBusinessHoursConfigured(unitBusinessHours(agenda))
}

export function unitHasAddressAndHours(unit: Pick<Unit, 'address' | 'agenda'>): boolean {
  return isAddressComplete(unit.address) && unitHasUsableHours(unit.agenda)
}

export function isUnitPubliclyLive(unit: Pick<Unit, 'address' | 'agenda'>): boolean {
  return isUnitBookable(unit) && unitHasAddressAndHours(unit)
}
