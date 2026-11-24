const DTF_CACHE = new Map<string, Intl.DateTimeFormat>()

function getFormatter(tz: string): Intl.DateTimeFormat {
  let dtf = DTF_CACHE.get(tz)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    DTF_CACHE.set(tz, dtf)
  }
  return dtf
}

function partsOf(dtf: Intl.DateTimeFormat, d: Date): (type: string) => string {
  const parts = dtf.formatToParts(d)
  return (type: string) => parts.find((p) => p.type === type)?.value ?? ''
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function assertValidTimezone(tz: string): void {
  if (!isValidTimezone(tz)) throw new Error(`Invalid IANA timezone: ${tz}`)
}

export type OrgTime = { dateISO: string; hour: number; minute: number }

export function toOrgTime(utcIso: string, tz: string): OrgTime {
  const d = new Date(utcIso)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid UTC ISO: ${utcIso}`)
  const get = partsOf(getFormatter(tz), d)
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  return {
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute: Number(get('minute')),
  }
}

function getOffsetMs(tz: string, instant: Date): number {
  const get = partsOf(getFormatter(tz), instant)
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    hour,
    Number(get('minute')),
    Number(get('second')),
  )
  return asUtc - instant.getTime()
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function fromOrgTime(
  { date, hour, minute }: { date: string; hour: number; minute: number },
  tz: string,
): string {
  const m = DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`)
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, 0, 0)
  const offset1 = getOffsetMs(tz, new Date(naive))
  const offset2 = getOffsetMs(tz, new Date(naive - offset1))
  return new Date(naive - offset2).toISOString()
}

function addDays(dateISO: string, days: number): string {
  const m = DATE_RE.exec(dateISO)
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${dateISO}`)
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)
  const d = new Date(t)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function getTodayInOrgTz(tz: string, now: Date = new Date()): string {
  return toOrgTime(now.toISOString(), tz).dateISO
}

export function getOrgDayBoundsUtc(date: string, tz: string): { startUtc: string; endUtc: string } {
  const startUtc = fromOrgTime({ date, hour: 0, minute: 0 }, tz)
  const startOfNext = fromOrgTime({ date: addDays(date, 1), hour: 0, minute: 0 }, tz)
  const endUtc = new Date(new Date(startOfNext).getTime() - 1).toISOString()
  return { startUtc, endUtc }
}

export function shiftDateInOrgTz(date: string, days: number, _tz: string): string {
  return addDays(date, days)
}
