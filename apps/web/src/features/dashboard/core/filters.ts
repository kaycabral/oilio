import { fromOrgTime, getTodayInOrgTz, shiftDateInOrgTz } from '@/domain'

export const DASHBOARD_PERIODS = ['today', '7d', '30d', 'month', 'custom'] as const
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

export const DEFAULT_PERIOD: DashboardPeriod = '30d'

export type DashboardFilters = {
  unitId: string | null
  period: DashboardPeriod
  fromDate: string
  toDate: string
  fromUtc: string
  toUtcExclusive: string
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

  const unitId: string | null = null

  const fromUtc = fromOrgTime({ date: fromDate, hour: 0, minute: 0 }, orgTimezone)
  const toUtcExclusive = fromOrgTime(
    { date: shiftDateInOrgTz(toDate, 1, 'UTC'), hour: 0, minute: 0 },
    orgTimezone,
  )

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
