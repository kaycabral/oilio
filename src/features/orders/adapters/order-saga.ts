import {
  type CashMovement,
  type Commission,
  type computeOrderTotals,
  isCatalogProduct,
  type Order,
  type PaymentMethod,
} from '@/domain'
import {
  AppointmentConfig,
  CashMovementConfig,
  CatalogItemConfig,
  CommissionConfig,
  OrderConfig,
  SubscriptionConfig,
} from '@/domain/aggregates'
import {
  aggregateRef,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'

import { buildSaleMovement } from '@/features/cash/adapters/sale-movement'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { commitSaga, type WriteSecurity } from '@/shared/effect-bridge'
import 'server-only'

import { type ConsumptionPlan } from './order-write-helpers'

async function resolveStockTargets(
  orgId: string,
  stockDecrements: { refId: string; quantity: number }[],
): Promise<{ refId: string; nextStock: number }[]> {
  const targets: { refId: string; nextStock: number }[] = []
  for (const dec of stockDecrements) {
    const item = await getCatalogItemById(orgId, dec.refId)
    if (!item) continue
    if (!isCatalogProduct(item)) continue
    targets.push({ refId: dec.refId, nextStock: Math.max(0, item.stock - dec.quantity) })
  }
  return targets
}

export function buildCloseOrderSteps(args: {
  orgId: string
  actorUid: string
  orderId: string
  order: Order
  paymentMethod: PaymentMethod | null
  totals: ReturnType<typeof computeOrderTotals>
  closedAt: string
  subscriptionToConsume: { id: string; amount: number } | null
  stockTargets: { refId: string; nextStock: number }[]
  commissions: Commission[]
  saleMovement: CashMovement | null
}): SagaStep[] {
  const { orgId, actorUid, orderId, order, paymentMethod, totals, closedAt } = args
  const steps: SagaStep[] = []

  if (args.subscriptionToConsume) {
    const sub = args.subscriptionToConsume
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        SubscriptionConfig,
        aggregateRef(SubscriptionConfig, orgId, sub.id),
        {
          _tag: 'subscription.usage_incremented',
          actorId: actorUid,
          payload: { amount: sub.amount },
        },
        tx,
      ),
    )
  }

  for (const target of args.stockTargets) {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        CatalogItemConfig,
        aggregateRef(CatalogItemConfig, orgId, target.refId),
        {
          _tag: 'catalog_item.updated',
          actorId: actorUid,
          payload: { changes: { stock: target.nextStock } },
        },
        tx,
      ),
    )
  }

  for (const commission of args.commissions) {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        CommissionConfig,
        aggregateRef(CommissionConfig, orgId, commission.id),
        {
          _tag: 'commission.created',
          actorId: actorUid,
          payload: { data: commission },
        },
        tx,
      ),
    )
  }

  if (args.saleMovement) {
    const movement = args.saleMovement
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        CashMovementConfig,
        aggregateRef(CashMovementConfig, orgId, movement.id),
        {
          _tag: 'cash_movement.created',
          actorId: actorUid,
          payload: { data: movement },
        },
        tx,
      ),
    )
  }

  if (order.appointmentId) {
    const appointmentId = order.appointmentId
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        AppointmentConfig,
        aggregateRef(AppointmentConfig, orgId, appointmentId),
        {
          _tag: 'appointment.completed',
          actorId: actorUid,
          payload: {},
        },
        tx,
      ),
    )
  }

  steps.push((tx: TransactionContext) =>
    appendEventToTx(
      OrderConfig,
      aggregateRef(OrderConfig, orgId, orderId),
      {
        _tag: 'order.closed',
        actorId: actorUid,
        payload: {
          closedAt,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          paymentMethod,
          items: order.items,
          unitId: order.unitId,
        },
      },
      tx,
    ),
  )

  return steps
}

export async function emitCloseOrderSaga(args: {
  orgId: string
  actorUid: string
  orderId: string
  order: Order
  paymentMethod: PaymentMethod | null
  totals: ReturnType<typeof computeOrderTotals>
  closedAt: string
  consumption: ConsumptionPlan
  commissions: Commission[]
  security?: WriteSecurity
}): Promise<string | null> {
  const { orgId, actorUid, orderId, order, paymentMethod, totals, closedAt } = args
  const { subscriptionToConsume, stockDecrements } = args.consumption

  const saleMovement =
    paymentMethod && totals.totalCents > 0
      ? buildSaleMovement({
          orgId,
          unitId: order.unitId,
          orderId,
          amountCents: totals.totalCents,
          paymentMethod,
          actorUid,
        })
      : null

  const stockTargets = await resolveStockTargets(orgId, stockDecrements)
  const steps = buildCloseOrderSteps({
    orgId,
    actorUid,
    orderId,
    order,
    paymentMethod,
    totals,
    closedAt,
    subscriptionToConsume,
    stockTargets,
    commissions: args.commissions,
    saleMovement,
  })
  const outcome = await commitSaga(steps, args.security)
  return outcome.ok ? null : outcome.error
}
