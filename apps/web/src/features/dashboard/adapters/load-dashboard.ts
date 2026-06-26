import { DEFAULT_UNIT_TIMEZONE } from '@/domain'
import { loadDashboardKpis } from '@/features/dashboard/adapters/kpis.repo'
import { loadDashboardPendencies } from '@/features/dashboard/adapters/pendencies.repo'
import { loadDashboardTrend } from '@/features/dashboard/adapters/trend.repo'
import { type DashboardFilters, resolveDashboardFilters } from '@/features/dashboard/core/filters'
import { type DashboardKpis } from '@/features/dashboard/core/kpis'
import { type DashboardPendencies } from '@/features/dashboard/core/pendencies'
import { type TrendPoint } from '@/features/dashboard/core/trend'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { redirect } from 'next/navigation'
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
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const orgId = ctx.membership.orgId
  // Active (non-archived) units ordered by name. The dashboard only ever scopes
  // to the active unit (KPIs/trend/pendencies) and labels it + pendency items —
  // an archived unit can never be the active unit nor own an open pendency, so
  // the active-only narrowing vs the former all-units read is inert here.
  const units = await listUnitsForOrg(orgId)
  // Every surface reads only the active unit from the shared context (brief
  // 0044): the cross-unit aggregate ("Todas as unidades") is gone. The top
  // switcher is the single source of unit context; `activeUnitId` is null only
  // for a org with no units yet (operational data is empty in that case).
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)
  // Timezone is the establishment's (PRD Identidade v2 — moved Org→Unit): use
  // the active unit's tz; fall back to the first unit / default for an org with
  // no unit yet.
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
  // KPIs/trend always scope to the active unit.
  const scopedFilters = { ...filters, unitId: activeUnitId }

  // Pendências are operational — always scoped to the active unit.
  const pendenciesUnitId = activeUnitId
  const [kpis, trendPoints, pendencies] = await Promise.all([
    loadDashboardKpis(orgId, scopedFilters),
    loadDashboardTrend(orgId, orgTz, scopedFilters),
    loadDashboardPendencies(orgId, pendenciesUnitId),
  ])

  // Lookup tables so the pendencies panel can display human-readable names
  // without N extra reads per item. Customers are restricted to the ones
  // referenced by open orders — full customer list is intentionally not
  // loaded here.
  const unitsById = Object.fromEntries(units.map((u) => [u.id, u.name]))
  // Vendas avulsas (brief 0030) não têm cliente — só os ids referenciados (não
  // nulos) precisam virar nome.
  const referencedCustomerIds = new Set(
    pendencies.openOrders.map((c) => c.customerId).filter((id): id is string => id !== null),
  )
  const customersById: Record<string, string> = {}
  if (referencedCustomerIds.size > 0) {
    // `name` is PII (lives on `users/`); the canonical org-scoped read resolves
    // names via enrichment (handles blocked/anonymized labels). Filtered to the
    // referenced ids in memory — the org's customer collection is small and the
    // Firestore `in` 30-id cap (a query limit, not a semantic one) no longer
    // applies, so every referenced customer now resolves.
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
