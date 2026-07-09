import { Order, Subscription } from '@/domain'
import type { DashboardFilters } from '@/features/dashboard/core/filters'
import { type TrendPoint, bucketByLocalDay, listLocalDays } from '@/features/dashboard/core/trend'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import {
  type SubscriptionRow,
  rowToDoc as subscriptionRowToDoc,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

async function loadClosedOrders(orgId: string, filters: DashboardFilters): Promise<Order[]> {
  const unitClause = filters.unitId === null ? 'unit_id IS NULL' : 'unit_id = $4'
  const params: unknown[] = [orgId, filters.fromUtc, filters.toUtcExclusive]
  if (filters.unitId !== null) params.push(filters.unitId)
  const rows = await readUnderRls<OrderRow>(
    orgId,
    (client) =>
      client
        .query<OrderRow>(
          `SELECT * FROM orders
             WHERE org_id = $1 AND status = 'closed'
               AND closed_at >= $2 AND closed_at < $3 AND ${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    filters.unitId ?? '',
  )
  return rows.map((r) => decodeOrder(orderRowToDoc(r)))
}

async function loadSubscriptionsCreatedInWindow(
  orgId: string,
  filters: DashboardFilters,
): Promise<Subscription[]> {
  const params: unknown[] = [orgId, filters.fromUtc, filters.toUtcExclusive]
  let unitClause = ''
  if (filters.unitId !== null) {
    params.push(filters.unitId)
    unitClause = ` AND unit_id = $${params.length}`
  }
  const rows = await readUnderRls<SubscriptionRow>(
    orgId,
    (client) =>
      client
        .query<SubscriptionRow>(
          `SELECT * FROM subscriptions
             WHERE org_id = $1 AND created_at >= $2 AND created_at < $3${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    filters.unitId ?? '',
  )
  return rows.map((r) => decodeSubscription(subscriptionRowToDoc(r)))
}

export async function loadDashboardTrend(
  orgId: string,
  orgTimezone: string,
  filters: DashboardFilters,
): Promise<TrendPoint[]> {
  const dayList = listLocalDays(filters.fromDate, filters.toDate, orgTimezone)

  const [orders, subs] = await Promise.all([
    loadClosedOrders(orgId, filters),
    loadSubscriptionsCreatedInWindow(orgId, filters),
  ])

  return bucketByLocalDay(orders, subs, orgTimezone, dayList)
}
