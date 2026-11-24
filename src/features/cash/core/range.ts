import { getOrgDayBoundsUtc, getTodayInOrgTz, shiftDateInOrgTz } from '@/domain'

export const CASH_REPORT_PERIODS = ['day', 'week', 'month', 'custom'] as const
export type CashReportPeriod = (typeof CASH_REPORT_PERIODS)[number]
export const DEFAULT_CASH_REPORT_PERIOD: CashReportPeriod = 'day'

export type CashReportRange = {
  period: CashReportPeriod
  fromDate: string
  toDate: string
  fromIso: string
  toIso: string
}

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function isPeriod(v: unknown): v is CashReportPeriod {
  return typeof v === 'string' && (CASH_REPORT_PERIODS as readonly string[]).includes(v)
}

function requestedPeriod(params: {
  period?: string
  from?: string
  to?: string
}): CashReportPeriod {
  if (isPeriod(params.period)) return params.period
  if (params.from || params.to) return 'custom'
  return DEFAULT_CASH_REPORT_PERIOD
}

type DateWindow = { period: CashReportPeriod; fromDate: string; toDate: string }

function resolveCustomWindow(params: { from?: string; to?: string }, today: string): DateWindow {
  const f = params.from && isValidYmd(params.from) ? params.from : null
  const t = params.to && isValidYmd(params.to) ? params.to : null
  if (!f || !t) return { period: 'day', fromDate: today, toDate: today }
  const [fromDate, toDate] = f <= t ? [f, t] : [t, f]
  return { period: 'custom', fromDate, toDate }
}

function resolveDateWindow(
  requested: CashReportPeriod,
  params: { from?: string; to?: string },
  today: string,
  tz: string,
): DateWindow {
  switch (requested) {
    case 'custom':
      return resolveCustomWindow(params, today)
    case 'week':
      return { period: 'week', fromDate: shiftDateInOrgTz(today, -6, tz), toDate: today }
    case 'month':
      return { period: 'month', fromDate: `${today.slice(0, 7)}-01`, toDate: today }
    case 'day':
      return { period: 'day', fromDate: today, toDate: today }
  }
}

export function resolveCashReportRange(
  params: { period?: string; from?: string; to?: string },
  tz: string,
  now: Date = new Date(),
): CashReportRange {
  const today = getTodayInOrgTz(tz, now)
  const { period, fromDate, toDate } = resolveDateWindow(requestedPeriod(params), params, today, tz)

  const fromIso = getOrgDayBoundsUtc(fromDate, tz).startUtc
  const toIso = getOrgDayBoundsUtc(toDate, tz).endUtc

  return { period, fromDate, toDate, fromIso, toIso }
}
