import { Order } from '@/domain'
import {
  type DashboardPendencies,
  selectInactiveCustomerPendencies,
  selectOpenOrderPendencies,
} from '@/features/dashboard/core/pendencies'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)

async function loadOpenOrders(orgId: string, unitId: string | null): Promise<Order[]> {
  const params: unknown[] = [orgId]
  let unitClause = ''
  if (unitId) {
    params.push(unitId)
    unitClause = ` AND unit_id = $${params.length}`
  }
  const rows = await readUnderRls<OrderRow>(
    orgId,
    (client) =>
      client
        .query<OrderRow>(
          `SELECT * FROM orders WHERE org_id = $1 AND status = 'open'${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    unitId ?? '',
  )
  return rows.map((r) => decodeOrder(orderRowToDoc(r)))
}

export async function loadDashboardPendencies(
  orgId: string,
  unitId: string | null,
  now: Date = new Date(),
): Promise<DashboardPendencies> {
  const [orders, enrichedCustomers] = await Promise.all([
    loadOpenOrders(orgId, unitId),
    listCustomersForOrg(orgId),
  ])
  const sortedCustomers = enrichedCustomers
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, 50)

  return {
    openOrders: selectOpenOrderPendencies(orders, now),
    inactiveCustomers: selectInactiveCustomerPendencies(sortedCustomers, now),
  }
}
