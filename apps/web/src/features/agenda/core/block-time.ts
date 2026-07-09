import { toOrgTime } from '@/domain'

export function oneOffToLocal(
  startAt: string,
  endAt: string,
  tz: string,
): { date: string; start: string; end: string } {
  const s = toOrgTime(startAt, tz)
  const e = toOrgTime(endAt, tz)
  const start = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
  const end = `${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}`
  return { date: s.dateISO, start, end }
}
