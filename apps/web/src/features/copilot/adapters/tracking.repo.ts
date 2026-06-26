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

// Closed orders for the active unit in the goal window. `<=` on both bounds.
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

// Commissions in the goal window (org-wide; unit-scoping maps via the period's
// closed orders at the call-site, since a commission has no `unitId`).
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

// Settled (paid) charges for the active unit in the goal window — recurring
// recognized revenue. Scoped by the unit snapshot captured on the charge
// (`Charge.unitId`, #1117); `paid_at` is ISO text, inclusive on both bounds.
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

// All subscriptions owned by the active unit (MRR observation input). The
// caller filters the active subset.
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
  // Realizado = receita avulsa (order) + receita recorrente reconhecida (charge
  // liquidado no período), menos comissão. Tudo escopado à unidade ativa.
  revenueCents: number
  commissionCents: number
  // MRR da unidade — observação/projeção, NUNCA somado ao realizado (AC-08).
  // Snapshot point-in-time das assinaturas ativas.
  mrrCents: number
}

// Realizado inputs for the active unit. Revenue = closed orders (avulso) +
// settled subscription charges in the period (recorrente reconhecida, AC-08);
// commission is subtracted. MRR is computed separately as an observation — it
// is NOT recognized revenue and never enters the realizado.
export async function loadGoalActuals(
  orgId: string,
  unitId: string,
  window: GoalPeriodWindow,
): Promise<GoalActuals> {
  const [orders, charges, commissions, subscriptions] = await Promise.all([
    loadClosedOrders(orgId, unitId, window),
    // Recurring recognized revenue: charges settled (paid) within the period,
    // scoped by the unit snapshot captured on the charge (`Charge.unitId`, #1117).
    loadPaidChargesInWindow(orgId, unitId, window),
    loadCommissionsInWindow(orgId, window),
    // MRR observation: active subscriptions owned by the unit.
    loadSubscriptionsForUnit(orgId, unitId),
  ])

  const orderRevenueCents = orders.reduce((acc, o) => acc + o.totalCents, 0)

  const recurringRevenueCents = charges.reduce((acc, c) => acc + c.amountCents, 0)

  // Commission has no `unitId` (it references the closing order), so unit-scoping
  // maps via the period's closed orders for this unit — mirrors reports.
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
