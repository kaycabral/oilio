import { fromOrgTime, getTodayInOrgTz, shiftDateInOrgTz } from '@/domain'

export const DASHBOARD_PERIODS = ['today', '7d', '30d', 'month', 'custom'] as const
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

export const DEFAULT_PERIOD: DashboardPeriod = '30d'

export type DashboardFilters = {
  // Unit to scope KPIs/trend by (brief 0044 — always the active unit). Null only
  // when the org has no units yet. Resolved by the page from the active unit,
  // NOT from a dashboard query param: `resolveDashboardFilters` always leaves it
  // null and the page overlays the active-unit value.
  unitId: string | null
  period: DashboardPeriod
  // Local YYYY-MM-DD labels in org tz, inclusive on both ends.
  fromDate: string
  toDate: string
  // UTC ISO bounds (start inclusive, end exclusive — the instant the next
  // local day begins). Use these for Firestore range queries.
  fromUtc: string
  toUtcExclusive: string
  // Previous period of equal length, immediately preceding [fromDate, toDate].
  previousFromDate: string
  previousToDate: string
  previousFromUtc: string
  previousToUtcExclusive: string
}

export type DashboardFilterInput = {
  period?: string
  from?: string
  to?: string
}

function isDashboardPeriod(v: unknown): v is DashboardPeriod {
  return typeof v === 'string' && (DASHBOARD_PERIODS as readonly string[]).includes(v)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function daysBetween(fromDate: string, toDate: string): number {
  // Inclusive distance: same-day = 1.
  const a = Date.UTC(
    Number(fromDate.slice(0, 4)),
    Number(fromDate.slice(5, 7)) - 1,
    Number(fromDate.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(toDate.slice(0, 4)),
    Number(toDate.slice(5, 7)) - 1,
    Number(toDate.slice(8, 10)),
  )
  return Math.round((b - a) / 86_400_000) + 1
}

function startOfMonth(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`
}

function endOfPreviousMonth(monthStart: string): string {
  return shiftDateInOrgTz(monthStart, -1, 'UTC')
}

function resolvePeriodWindow(
  period: DashboardPeriod,
  todayISO: string,
  customFrom: string | undefined,
  customTo: string | undefined,
): { fromDate: string; toDate: string; period: DashboardPeriod } {
  if (period === 'today') {
    return { fromDate: todayISO, toDate: todayISO, period }
  }
  if (period === '7d') {
    return { fromDate: shiftDateInOrgTz(todayISO, -6, 'UTC'), toDate: todayISO, period }
  }
  if (period === '30d') {
    return { fromDate: shiftDateInOrgTz(todayISO, -29, 'UTC'), toDate: todayISO, period }
  }
  if (period === 'month') {
    return { fromDate: startOfMonth(todayISO), toDate: todayISO, period }
  }
  // custom — fall back to 30d if either side is missing/invalid or inverted
  if (!customFrom || !customTo || !DATE_RE.test(customFrom) || !DATE_RE.test(customTo)) {
    return resolvePeriodWindow('30d', todayISO, undefined, undefined)
  }
  if (customFrom > customTo) {
    return resolvePeriodWindow('30d', todayISO, undefined, undefined)
  }
  return { fromDate: customFrom, toDate: customTo, period: 'custom' }
}

export function resolveDashboardFilters(
  input: DashboardFilterInput,
  orgTimezone: string,
  now: Date = new Date(),
): DashboardFilters {
  const period: DashboardPeriod = isDashboardPeriod(input.period) ? input.period : DEFAULT_PERIOD
  const todayISO = getTodayInOrgTz(orgTimezone, now)
  const {
    fromDate,
    toDate,
    period: resolvedPeriod,
  } = resolvePeriodWindow(period, todayISO, input.from, input.to)

  // Unit scoping is resolved by the page (the active unit, brief 0044), never
  // from a dashboard query param. Always start null.
  const unitId: string | null = null

  const fromUtc = fromOrgTime({ date: fromDate, hour: 0, minute: 0 }, orgTimezone)
  const toUtcExclusive = fromOrgTime(
    { date: shiftDateInOrgTz(toDate, 1, 'UTC'), hour: 0, minute: 0 },
    orgTimezone,
  )

  // Previous period: same length, immediately preceding fromDate. Month uses
  // the calendar previous month instead, to match owner intuition.
  let previousFromDate: string
  let previousToDate: string
  if (resolvedPeriod === 'month') {
    previousToDate = endOfPreviousMonth(fromDate)
    previousFromDate = startOfMonth(previousToDate)
  } else {
    const length = daysBetween(fromDate, toDate)
    previousToDate = shiftDateInOrgTz(fromDate, -1, 'UTC')
    previousFromDate = shiftDateInOrgTz(previousToDate, -(length - 1), 'UTC')
  }
  const previousFromUtc = fromOrgTime({ date: previousFromDate, hour: 0, minute: 0 }, orgTimezone)
  const previousToUtcExclusive = fromOrgTime(
    { date: shiftDateInOrgTz(previousToDate, 1, 'UTC'), hour: 0, minute: 0 },
    orgTimezone,
  )

  return {
    unitId,
    period: resolvedPeriod,
    fromDate,
    toDate,
    fromUtc,
    toUtcExclusive,
    previousFromDate,
    previousToDate,
    previousFromUtc,
    previousToUtcExclusive,
  }
}

export function periodLabel(period: DashboardPeriod): string {
  switch (period) {
    case 'today':
      return 'Hoje'
    case '7d':
      return 'Últimos 7 dias'
    case '30d':
      return 'Últimos 30 dias'
    case 'month':
      return 'Mês atual'
    case 'custom':
      return 'Personalizado'
  }
}
