// Close-order + undo-close sagas — extracted from order-write-helpers to stay
// under the module-size gate. Both run as ONE Postgres ACID transaction (brief
// 0061 § Grupo A / AC-02).

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

// Resolves the absolute target stock for each product BEFORE the close runs,
// reading the live catalog stock and clamping at 0, lifted out so the Postgres
// saga can append the resolved value as a pure step (no read needed inside the
// cascade). The `stockDecrements` list already came from the single-source
// `stockDecrementTargets` (every product, regardless of coverage — #B4). Skips
// non-product / missing refs, so the saga step set is deterministic.
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

// Builds the close-order cascade as an ordered list of saga steps (brief 0061 §
// Grupo A / AC-02). Each step appends one aggregate's event THROUGH the shared
// transaction (`appendEventToTx`), so under Postgres the whole cascade commits
// atomically (or rolls back as one). Order mirrors the Firestore saga: assinatura
// → estoque → comissões → caixa → appointment.completed → order.closed (anchor).
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
          // Snapshot the items + unit on the event (ADR 0016 D5): the Razão derives
          // per-item revenue from `order.closed` alone, scoped to the unit. The
          // order is immutable at close (only open orders take item edits), so
          // this is the final shape.
          items: order.items,
          unitId: order.unitId,
        },
      },
      tx,
    ),
  )

  return steps
}

// Cascata-saga (#1026): no backend Postgres (brief 0061 § Grupo A / AC-02) a
// cascata roda como UMA transação ACID via `commitSaga`: todos os eventos +
// projeções commitam juntos, e uma falha no meio (CHECK/FK/RLS) faz ROLLBACK
// total — zero linha de qualquer aggregate. A atomicidade do banco substitui a
// compensação manual: não há desfazer. Ordem: consumo de assinatura → estoque →
// comissões → caixa → appointment.completed → order.closed (âncora, por último).
//
// Retorna erro ou null.
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
  // Own-scope RLS for the WRITE (brief 0075, #1265): the saga emits
  // `appointment.completed` on the own-scope-protected `appointments` table, so a
  // self-scoped closer must run under their own scope — the DB WITH CHECK is the
  // last line of defense, not just the `canOperateOpenOrder` app gate. Undefined
  // for the balcão (permissive).
  security?: WriteSecurity
}): Promise<string | null> {
  const { orgId, actorUid, orderId, order, paymentMethod, totals, closedAt } = args
  const { subscriptionToConsume, stockDecrements } = args.consumption

  // Caixa sem sessão (brief 0015): só a parte vendida vira movimento `sale`.
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

  // Pre-resolve the live stock targets (read outside the tx — the quantity is
  // fixed; reading current stock to clamp is the only dependency), then run the
  // whole cascade as ONE ACID transaction.
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
