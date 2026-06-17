import { Order, Subscription } from '@/domain'
import type { DashboardFilters } from '@/features/dashboard/core/filters'
import { scopeByUnit } from '@/features/dashboard/core/scope'
import { type TrendPoint, bucketByLocalDay, listLocalDays } from '@/features/dashboard/core/trend'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import 'server-only'

export async function loadDashboardTrend(
  tenantId: string,
  tenantTimezone: string,
  filters: DashboardFilters,
): Promise<TrendPoint[]> {
  const tenantRef = getAdminFirestore().collection('tenants').doc(tenantId)
  const dayList = listLocalDays(filters.fromDate, filters.toDate, tenantTimezone)

  const ordersQuery = tenantRef
    .collection('orders')
    .withConverter(fsConverter(Order))
    .where('status', '==', 'closed')
    .where('closedAt', '>=', filters.fromUtc)
    .where('closedAt', '<', filters.toUtcExclusive)
    .where('unitId', '==', filters.unitId)

  // `newSubs` reflete só a unidade ativa (brief 0043, AC-03): a assinatura é
  // dona de uma unidade (`Subscription.unitId`, #1117), então escopa quando há
  // unidade ativa — tenant-wide só quando não há nenhuma no contexto.
  const subsQuery = scopeByUnit(
    tenantRef
      .collection('subscriptions')
      .withConverter(fsConverter(Subscription))
      .where('createdAt', '>=', filters.fromUtc)
      .where('createdAt', '<', filters.toUtcExclusive),
    filters.unitId,
  )

  const [ordersSnap, subsSnap] = await Promise.all([ordersQuery.get(), subsQuery.get()])
  const orders = ordersSnap.docs.map((d) => d.data())
  const subs = subsSnap.docs.map((d) => d.data())

  return bucketByLocalDay(orders, subs, tenantTimezone, dayList)
}
