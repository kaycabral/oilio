import { fromOrgTime, getTodayInOrgTz, shiftDateInOrgTz } from '@/domain'

export type SnoozeOption = '4h' | 'tomorrow'

export function isSnoozeOption(value: string): value is SnoozeOption {
  return value === '4h' || value === 'tomorrow'
}

export function computeSnoozeUntil(option: SnoozeOption, now: Date, tz: string): string {
  if (option === '4h') {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
  }
  const today = getTodayInOrgTz(tz, now)
  const tomorrow = shiftDateInOrgTz(today, 1, tz)
  return fromOrgTime({ date: tomorrow, hour: 9, minute: 0 }, tz)
}

export function isSnoozedAt(snoozedUntil: string | null, now: Date): boolean {
  if (!snoozedUntil) return false
  return new Date(snoozedUntil).getTime() > now.getTime()
}
