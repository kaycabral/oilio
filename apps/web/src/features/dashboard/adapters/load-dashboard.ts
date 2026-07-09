import { DEFAULT_UNIT_TIMEZONE } from '@/domain'
import { loadDashboardKpis } from '@/features/dashboard/adapters/kpis.repo'
import { loadDashboardPendencies } from '@/features/dashboard/adapters/pendencies.repo'
import { loadDashboardTrend } from '@/features/dashboard/adapters/trend.repo'
import { type DashboardFilters, resolveDashboardFilters } from '@/features/dashboard/core/filters'
import { type DashboardKpis } from '@/features/dashboard/core/kpis'
import { type DashboardPendencies } from '@/features/dashboard/core/pendencies'
import { type TrendPoint } from '@/features/dashboard/core/trend'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { requireManagerPage } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

type SearchParams = Record<string, string | string[] | undefined>

export type DashboardPageProps = {
  filters: DashboardFilters
  kpis: DashboardKpis
  trendPoints: TrendPoint[]
  pendencies: DashboardPendencies
  unitsById: Record<string, string>
  customersById: Record<string, string>
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export async function loadDashboardPage(params: SearchParams): Promise<DashboardPageProps> {
  const ctx = await requireManagerPage()

  const orgId = ctx.membership.orgId
  const units = await listUnitsForOrg(orgId)
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)
  const orgTz =
    (activeUnitId ? units.find((u) => u.id === activeUnitId)?.timezone : undefined) ??
    units[0]?.timezone ??
    DEFAULT_UNIT_TIMEZONE
  const filters = resolveDashboardFilters(
    {
      period: pickFirst(params.period),
      from: pickFirst(params.from),
      to: pickFirst(params.to),
    },
    orgTz,
  )
  const scopedFilters = { ...filters, unitId: activeUnitId }

  const pendenciesUnitId = activeUnitId
  const [kpis, trendPoints, pendencies] = await Promise.all([
    loadDashboardKpis(orgId, scopedFilters),
    loadDashboardTrend(orgId, orgTz, scopedFilters),
    loadDashboardPendencies(orgId, pendenciesUnitId),
  ])

  const unitsById = Object.fromEntries(units.map((u) => [u.id, u.name]))
  const referencedCustomerIds = new Set(
    pendencies.openOrders.map((c) => c.customerId).filter((id): id is string => id !== null),
  )
  const customersById: Record<string, string> = {}
  if (referencedCustomerIds.size > 0) {
    const customers = await listCustomersForOrg(orgId)
    for (const c of customers) {
      if (referencedCustomerIds.has(c.id)) customersById[c.id] = c.name
    }
  }
  for (const c of pendencies.inactiveCustomers) {
    customersById[c.id] = c.name
  }

  return { filters, kpis, trendPoints, pendencies, unitsById, customersById }
}
