import { DEFAULT_TENANT_TIMEZONE, StoredCustomer, StoredUnit } from '@/domain'
import { loadDashboardKpis } from '@/features/dashboard/adapters/kpis.repo'
import { loadDashboardPendencies } from '@/features/dashboard/adapters/pendencies.repo'
import { loadDashboardTrend } from '@/features/dashboard/adapters/trend.repo'
import { type DashboardFilters, resolveDashboardFilters } from '@/features/dashboard/core/filters'
import { type DashboardKpis } from '@/features/dashboard/core/kpis'
import { type DashboardPendencies } from '@/features/dashboard/core/pendencies'
import { type TrendPoint } from '@/features/dashboard/core/trend'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/tenant/active-unit'
import { enrichCustomers } from '@/shared/tenant/customer-read'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { getTenant } from '@/shared/tenant/tenant'
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

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const tenantId = ctx.membership.tenantId
  const tenantRef = getAdminFirestore().collection('tenants').doc(tenantId)
  const [tenant, unitsSnap] = await Promise.all([
    getTenant(tenantId),
    tenantRef.collection('units').withConverter(fsConverter(StoredUnit)).orderBy('name').get(),
  ])

  const units = unitsSnap.docs.map((d) => d.data())
  // Every surface reads only the active unit from the shared context (brief
  // 0044): the cross-unit aggregate ("Todas as unidades") is gone. The top
  // switcher is the single source of unit context; `activeUnitId` is null only
  // for a tenant with no units yet (operational data is empty in that case).
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)
  const filters = resolveDashboardFilters(
    {
      period: pickFirst(params.period),
      from: pickFirst(params.from),
      to: pickFirst(params.to),
    },
    tenant?.timezone ?? DEFAULT_TENANT_TIMEZONE,
  )
  // KPIs/trend always scope to the active unit.
  const scopedFilters = { ...filters, unitId: activeUnitId }

  const tenantTz = tenant?.timezone ?? DEFAULT_TENANT_TIMEZONE
  // Pendências are operational — always scoped to the active unit.
  const pendenciesUnitId = activeUnitId
  const [kpis, trendPoints, pendencies] = await Promise.all([
    loadDashboardKpis(tenantId, scopedFilters),
    loadDashboardTrend(tenantId, tenantTz, scopedFilters),
    loadDashboardPendencies(tenantId, pendenciesUnitId),
  ])

  // Lookup tables so the pendencies panel can display human-readable names
  // without N extra reads per item. Customers are restricted to the ones
  // referenced by open orders — full customer list is intentionally not
  // loaded here.
  const unitsById = Object.fromEntries(units.map((u) => [u.id, u.name]))
  // Vendas avulsas (brief 0030) não têm cliente — filtra os nulls antes do
  // lookup `where('id','in',...)` (Firestore não aceita null no `in`).
  const referencedCustomerIds = Array.from(
    new Set(
      pendencies.openOrders.map((c) => c.customerId).filter((id): id is string => id !== null),
    ),
  )
  const customersById: Record<string, string> = {}
  if (referencedCustomerIds.length > 0) {
    // `name` is PII (lives on `users/`), so read the stored shadow and resolve
    // names via the canonical enrichment (handles blocked/anonymized labels).
    const customersSnap = await tenantRef
      .collection('customers')
      .withConverter(fsConverter(StoredCustomer))
      .where('id', 'in', referencedCustomerIds.slice(0, 30))
      .get()
    const enriched = await enrichCustomers(
      tenantId,
      customersSnap.docs.map((doc) => doc.data()),
    )
    for (const c of enriched) {
      customersById[c.id] = c.name
    }
  }
  for (const c of pendencies.inactiveCustomers) {
    customersById[c.id] = c.name
  }

  return { filters, kpis, trendPoints, pendencies, unitsById, customersById }
}
