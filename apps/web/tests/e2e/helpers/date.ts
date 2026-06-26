// Date helpers shared across E2E specs.
//
// Specs need a deterministic future weekday to seed appointments and exercise
// the public booking flow. Each spec used to reimplement nextWeekday() inline
// (5 copies, two type signatures); centralising avoids drift and gives one
// place to fix bugs (e.g. month-end wrap, DST).

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

// Returns the next occurrence of `target` (exclusive of today) as a UTC
// `YYYY-MM-DD` string. Accepts both the Weekday string form and the numeric
// 0–6 form (Sunday = 0, matching `Date#getUTCDay()`).
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
