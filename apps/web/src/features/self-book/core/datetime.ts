// Pure datetime helpers for the public self-book flow. The legacy
// `/{slug}/book` form posts a `datetime-local` value ("yyyy-MM-ddTHH:mm",
// no timezone) — the browser sends wall-clock digits with no offset.
// Interpreting those as UTC would be wrong; we treat them as the tenant's
// local wall clock and resolve the equivalent UTC instant, accounting for
// DST via `Intl.DateTimeFormat`.

// Converts "yyyy-MM-ddTHH:mm" (no tz), read as the tenant's local time, to
// the equivalent UTC instant. Throws on malformed input.
export function parseTenantLocalAsUtc(local: string, timezone: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) throw new Error('invalid datetime-local')
  const [, yStr, moStr, dStr, hStr, miStr] = m
  const y = Number(yStr)
  const mo = Number(moStr)
  const d = Number(dStr)
  const h = Number(hStr)
  const mi = Number(miStr)

  // First pass: assume the digits are UTC and compute the offset the target
  // timezone had at that UTC instant. Subtract it to align to the desired
  // local wall-clock time.
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offsetMs = tzOffsetAt(guess, timezone)
  return new Date(guess - offsetMs)
}

// Offset (ms) of `timezone` at the given UTC instant. Positive = ahead of UTC.
export function tzOffsetAt(utcMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour') === 24 ? 0 : pick('hour'),
    pick('minute'),
    pick('second'),
  )
  return asUtc - utcMs
}
