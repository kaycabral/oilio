import { Order } from '@/domain'
import type { DashboardFilters } from '@/features/dashboard/core/filters'
import {
  type SubscriptionActivation,
  type TrendPoint,
  bucketByLocalDay,
  listLocalDays,
} from '@/features/dashboard/core/trend'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)

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

type ActivatedAtRow = { activated_at: string }

async function loadSubscriptionsActivatedInWindow(
  orgId: string,
  filters: DashboardFilters,
): Promise<SubscriptionActivation[]> {
  const params: unknown[] = [orgId, filters.fromUtc, filters.toUtcExclusive]
  let unitClause = ''
  if (filters.unitId !== null) {
    params.push(filters.unitId)
    unitClause = ` AND s.unit_id = $${params.length}`
  }
  const rows = await readUnderRls<ActivatedAtRow>(
    orgId,
    (client) =>
      client
        .query<ActivatedAtRow>(
          `SELECT act.activated_at
             FROM subscriptions s
             CROSS JOIN LATERAL (
               SELECT COALESCE(
                        (SELECT MIN(c.period_start_at)
                           FROM charges c
                          WHERE c.org_id = s.org_id AND c.subscription_id = s.id),
                        s.created_at
                      ) AS activated_at
             ) act
             WHERE s.org_id = $1
               AND act.activated_at >= $2
               AND act.activated_at < $3${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    filters.unitId ?? '',
  )
  return rows.map((r) => ({ activatedAt: new Date(r.activated_at).toISOString() }))
}

export async function loadDashboardTrend(
  orgId: string,
  orgTimezone: string,
  filters: DashboardFilters,
): Promise<TrendPoint[]> {
  const dayList = listLocalDays(filters.fromDate, filters.toDate, orgTimezone)

  const [orders, subs] = await Promise.all([
    loadClosedOrders(orgId, filters),
    loadSubscriptionsActivatedInWindow(orgId, filters),
  ])

  return bucketByLocalDay(orders, subs, orgTimezone, dayList)
}
