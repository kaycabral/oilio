import { Charge, Commission, Order, Subscription } from '@/domain'
import type { GoalPeriodWindow } from '@/features/copilot/core/tracking'
import { isActiveSubscription, subscriptionMrrCents } from '@/features/dashboard/core/kpis'
import { type ChargeRow, rowToDoc as chargeRowToDoc } from '@/shared/db/pg/effect/charge-projector'
import {
  type CommissionRow,
  rowToDoc as commissionRowToDoc,
} from '@/shared/db/pg/effect/commission-projector'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import {
  type SubscriptionRow,
  rowToDoc as subscriptionRowToDoc,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)
const decodeCommission = Schema.decodeUnknownSync(Commission)
const decodeCharge = Schema.decodeUnknownSync(Charge)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

async function loadClosedOrders(
  orgId: string,
  unitId: string,
  window: GoalPeriodWindow,
): Promise<Order[]> {
  const rows = await readUnderRls<OrderRow>(
    orgId,
    (client) =>
      client
        .query<OrderRow>(
          `SELECT * FROM orders
             WHERE org_id = $1 AND status = 'closed'
               AND closed_at >= $2 AND closed_at <= $3 AND unit_id = $4`,
          [orgId, window.fromIso, window.toIso, unitId],
        )
        .then((res) => res.rows),
    unitId,
  )
  return rows.map((r) => decodeOrder(orderRowToDoc(r)))
}

async function loadCommissionsInWindow(
  orgId: string,
  window: GoalPeriodWindow,
): Promise<Commission[]> {
  const rows = await readUnderRls<CommissionRow>(orgId, (client) =>
    client
      .query<CommissionRow>(
        `SELECT * FROM commissions
           WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [orgId, window.fromIso, window.toIso],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeCommission(commissionRowToDoc(r)))
}

async function loadPaidChargesInWindow(
  orgId: string,
  unitId: string,
  window: GoalPeriodWindow,
): Promise<Charge[]> {
  const rows = await readUnderRls<ChargeRow>(
    orgId,
    (client) =>
      client
        .query<ChargeRow>(
          `SELECT * FROM charges
             WHERE org_id = $1 AND status = 'paid'
               AND paid_at >= $2 AND paid_at <= $3 AND unit_id = $4`,
          [orgId, window.fromIso, window.toIso, unitId],
        )
        .then((res) => res.rows),
    unitId,
  )
  return rows.map((r) => decodeCharge(chargeRowToDoc(r)))
}

async function loadSubscriptionsForUnit(orgId: string, unitId: string): Promise<Subscription[]> {
  const rows = await readUnderRls<SubscriptionRow>(
    orgId,
    (client) =>
      client
        .query<SubscriptionRow>('SELECT * FROM subscriptions WHERE org_id = $1 AND unit_id = $2', [
          orgId,
          unitId,
        ])
        .then((res) => res.rows),
    unitId,
  )
  return rows.map((r) => decodeSubscription(subscriptionRowToDoc(r)))
}

export type GoalActuals = {
  revenueCents: number
  commissionCents: number
  mrrCents: number
}

export async function loadGoalActuals(
  orgId: string,
  unitId: string,
  window: GoalPeriodWindow,
): Promise<GoalActuals> {
  const [orders, charges, commissions, subscriptions] = await Promise.all([
    loadClosedOrders(orgId, unitId, window),
    loadPaidChargesInWindow(orgId, unitId, window),
    loadCommissionsInWindow(orgId, window),
    loadSubscriptionsForUnit(orgId, unitId),
  ])

  const orderRevenueCents = orders.reduce((acc, o) => acc + o.totalCents, 0)

  const recurringRevenueCents = charges.reduce((acc, c) => acc + c.amountCents, 0)

  const orderIds = new Set(orders.map((o) => o.id))
  const commissionCents = commissions
    .filter((c) => orderIds.has(c.orderId))
    .reduce((acc, c) => acc + c.amountCents, 0)

  const mrrCents = subscriptions
    .filter(isActiveSubscription)
    .reduce((acc, s) => acc + subscriptionMrrCents(s), 0)

  return {
    revenueCents: orderRevenueCents + recurringRevenueCents,
    commissionCents,
    mrrCents,
  }
}
