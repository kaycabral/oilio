// Undo-close saga — extracted from order-write-helpers/order-saga to stay under
// the module-size gate. Runs as ONE Postgres ACID transaction (brief 0061 §
// Grupo A / AC-02: reverse + reopen atomically, no manual compensation).

import { isCatalogProduct, type CashMovement, type Order } from '@/domain'
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
  appendDeleteToTx,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'

import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { commitSaga } from '@/shared/effect-bridge'
import 'server-only'

type UndoCloseArgs = {
  orgId: string
  actorUid: string
  order: Order
  subscriptionRestore: { id: string; amount: number } | null
  stockRestores: { refId: string; quantity: number }[]
  cashReversal: { movement: CashMovement } | null
  commissionIds: string[]
  reopen: {
    commissionsReversed: number
    cashReversalMovementId: string | null
    subscriptionRestored: boolean
  }
}

// Resolves the absolute restored stock for each product (every kind==='product',
// coverage-agnostic — #B4), reading live catalog stock, lifted so the Postgres
// saga can append it as a pure step. The input comes from `stockDecrementTargets`
// on close, so the undo restores EXACTLY what the close decremented — symmetry by
// construction. Never narrow this to "covered products": that reintroduces the B4
// hole (stock coupled to coverage) and desyncs close vs undo.
async function resolveStockRestoreTargets(
  orgId: string,
  stockRestores: { refId: string; quantity: number }[],
): Promise<{ refId: string; nextStock: number }[]> {
  const targets: { refId: string; nextStock: number }[] = []
  for (const restore of stockRestores) {
    const item = await getCatalogItemById(orgId, restore.refId)
    if (!item) continue
    if (!isCatalogProduct(item)) continue
    targets.push({ refId: restore.refId, nextStock: item.stock + restore.quantity })
  }
  return targets
}

// Builds the undo cascade as ordered saga steps (Postgres ACID path): appointment
// → scheduled, subscription cota restored, stock returned, cash reversal appended,
// commissions removed (event + projection drop via `appendDeleteToTx`), and the
// `order.reopened` anchor — ALL in one tx so the reopen is atomic.
export function buildUndoCloseSteps(args: {
  orgId: string
  actorUid: string
  order: Order
  subscriptionRestore: { id: string; amount: number } | null
  stockRestoreTargets: { refId: string; nextStock: number }[]
  cashReversal: { movement: CashMovement } | null
  commissionIds: string[]
  reopen: UndoCloseArgs['reopen']
  orderId: string
}): SagaStep[] {
  const { orgId, actorUid, order, subscriptionRestore, cashReversal, orderId } = args
  const steps: SagaStep[] = []

  if (order.appointmentId) {
    const appointmentId = order.appointmentId
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        AppointmentConfig,
        aggregateRef(AppointmentConfig, orgId, appointmentId),
        {
          _tag: 'appointment.updated',
          actorId: actorUid,
          payload: { changes: { status: 'scheduled' } },
        },
        tx,
      ),
    )
  }

  if (subscriptionRestore) {
    const restore = subscriptionRestore
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        SubscriptionConfig,
        aggregateRef(SubscriptionConfig, orgId, restore.id),
        {
          _tag: 'subscription.usage_incremented',
          actorId: actorUid,
          payload: { amount: -restore.amount },
        },
        tx,
      ),
    )
  }

  for (const target of args.stockRestoreTargets) {
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

  if (cashReversal) {
    const movement = cashReversal.movement
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

  for (const commissionId of args.commissionIds) {
    steps.push((tx: TransactionContext) =>
      appendDeleteToTx(
        CommissionConfig,
        aggregateRef(CommissionConfig, orgId, commissionId),
        {
          _tag: 'commission.deleted',
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
        _tag: 'order.reopened',
        actorId: actorUid,
        payload: args.reopen,
      },
      tx,
    ),
  )

  return steps
}

// Desfaz o fechamento de uma order dentro de 5 min. No backend Postgres (brief
// 0061 § Grupo A / AC-02): a reversão + o `order.reopened` rodam como UMA
// transação ACID via `commitSaga` — appointment volta a `scheduled`, cota
// restaurada, estoque devolvido, estorno de caixa apendado, comissões removidas
// (evento + projeção dropada na mesma tx) e a order reaberta, tudo atômico. Não
// há compensação manual: se qualquer passo falha, o banco faz ROLLBACK total.
//
// Retorna erro (string) ou null.
export async function emitUndoClose(args: UndoCloseArgs): Promise<string | null> {
  const { orgId, actorUid, order, subscriptionRestore, cashReversal } = args
  const orderId = order.id

  const stockRestoreTargets = await resolveStockRestoreTargets(orgId, args.stockRestores)
  const steps = buildUndoCloseSteps({
    orgId,
    actorUid,
    order,
    subscriptionRestore,
    stockRestoreTargets,
    cashReversal,
    commissionIds: args.commissionIds,
    reopen: args.reopen,
    orderId,
  })
  const outcome = await commitSaga(steps)
  return outcome.ok ? null : outcome.error
}
