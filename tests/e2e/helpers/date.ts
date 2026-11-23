export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

const WEEKDAY_INDEX: Record<Weekday, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function nextWeekday(target: Weekday | number): string {
  const targetIdx = typeof target === 'number' ? target : WEEKDAY_INDEX[target]
  const now = new Date()
  for (let i = 1; i < 14; i++) {
    const candidate = new Date(now.getTime() + i * 24 * 60 * 60_000)
    if (candidate.getUTCDay() === targetIdx) return toIsoDate(candidate)
  }
  throw new Error(`weekday not found within two weeks: ${String(target)}`)
}

export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
