import { toTenantTime } from '@/domain'

// Convert a one-off block's UTC range into tenant-local form-input strings
// (`date` YYYY-MM-DD, `start`/`end` HH:mm). Used to pre-fill the edit form and
// to render the "when" column.
export function oneOffToLocal(
  startAt: string,
  endAt: string,
  tz: string,
): { date: string; start: string; end: string } {
  const s = toTenantTime(startAt, tz)
  const e = toTenantTime(endAt, tz)
  const start = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
  const end = `${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}`
  return { date: s.dateISO, start, end }
}
