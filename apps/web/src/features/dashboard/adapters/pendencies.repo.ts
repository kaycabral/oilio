import { Order } from '@/domain'
import {
  type DashboardPendencies,
  selectInactiveCustomerPendencies,
  selectOpenOrderPendencies,
} from '@/features/dashboard/core/pendencies'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import 'server-only'

export async function loadDashboardPendencies(
  orgId: string,
  unitId: string | null,
  now: Date = new Date(),
): Promise<DashboardPendencies> {
  const orgRef = getAdminFirestore().collection('orgs').doc(orgId)

  let ordersQuery = orgRef
    .collection('orders')
    .withConverter(fsConverter(Order))
    .where('status', '==', 'open')
  if (unitId) ordersQuery = ordersQuery.where('unitId', '==', unitId)

  // Customers não têm unitId — a lista é org-wide independente do filtro.
  // Helper resolve User PII em batch; sorting + limit aplicado depois pra
  // manter o critério "menos atualizado primeiro" (sumido há mais tempo).
  const [ordersSnap, enrichedCustomers] = await Promise.all([
    ordersQuery.get(),
    listCustomersForOrg(orgId),
  ])
  const orders = ordersSnap.docs.map((d) => d.data())
  const sortedCustomers = enrichedCustomers
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, 50)

  return {
    openOrders: selectOpenOrderPendencies(orders, now),
    inactiveCustomers: selectInactiveCustomerPendencies(sortedCustomers, now),
  }
}
