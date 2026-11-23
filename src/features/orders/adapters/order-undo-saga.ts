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
    reopenedAt: string
    reversedClosedAt: string
    reversedRevenueCents: number
    unitId: string
    commissionsReversed: number
    cashReversalMovementId: string | null
    subscriptionRestored: boolean
  }
}

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
