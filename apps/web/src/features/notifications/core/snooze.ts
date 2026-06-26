import { fromOrgTime, getTodayInOrgTz, shiftDateInOrgTz } from '@/domain'

export type SnoozeOption = '4h' | 'tomorrow'

export function isSnoozeOption(value: string): value is SnoozeOption {
  return value === '4h' || value === 'tomorrow'
}

// Calcula o instante (ISO UTC) até quando a notificação fica oculta (AC-17).
// - '4h'       → agora + 4 horas
// - 'tomorrow' → amanhã às 09:00 no fuso do org
export function computeSnoozeUntil(option: SnoozeOption, now: Date, tz: string): string {
  if (option === '4h') {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
  }
  const today = getTodayInOrgTz(tz, now)
  const tomorrow = shiftDateInOrgTz(today, 1, tz)
  return fromOrgTime({ date: tomorrow, hour: 9, minute: 0 }, tz)
}

// Uma notificação está oculta (snoozed) quando snoozedUntil é futuro.
export function isSnoozedAt(snoozedUntil: string | null, now: Date): boolean {
  if (!snoozedUntil) return false
  return new Date(snoozedUntil).getTime() > now.getTime()
}
