'use server'

import { formString } from '@/shared/form-data'
import { revalidatePath } from 'next/cache'

import {
  type CashMovement,
  type PaymentMethod,
  computeOrderTotals,
  coveredItemQuantity,
  hasSaleItem,
  liquidationStatusOf,
  recognizedSaleRevenueCents,
  stockDecrementTargets,
} from '@/domain'
import { newId } from '@/shared/db/pg/new-id'

import { parsePaymentMethod, validateClosableItems } from '@/features/orders/core/order-helpers'

import { resolveWriteSecurity } from '@/shared/org/member-operation-read'
import { requireManagerCtx, requireOrgCtx } from '@/shared/org/membership'

import type { CloseOrderResult, OrderMutationResult } from '@/features/orders/core/order-results'
import {
  loadActiveSubscriptionId,
  loadCommissionsForOrder,
  loadOrderById,
  loadSaleMovementForOrder,
} from './order-financial-read'
import { emitCloseOrderSaga } from './order-saga'
import { emitUndoClose } from './order-undo-saga'
import {
  buildOrderCommissions,
  canOperateOpenOrder,
  loadOpenOrder,
  resolveSubscriptionConsumption,
} from './order-write-helpers'

const UNDO_CLOSE_WINDOW_MS = 5 * 60 * 1000

export type CloseOrderFormState = { ok: boolean; error?: string }
export type UndoCloseOrderFormState = { ok: boolean; error?: string }

export async function closeOrder(orderId: string, formData: FormData): Promise<CloseOrderResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const paymentMethodRaw = parsePaymentMethod(formString(formData, 'paymentMethod'))

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  if (!canOperateOpenOrder(r.ctx.membership, loaded.order.items)) {
    return { ok: false, error: 'Você só pode fechar comandas atribuídas a você' }
  }

  const itemsErr = validateClosableItems(loaded.order.items)
  if (itemsErr) return { ok: false, error: itemsErr }

  const sale = hasSaleItem(loaded.order.items)
  if (sale && !paymentMethodRaw) {
    return { ok: false, error: 'Forma de pagamento é obrigatória para itens de venda' }
  }
  const paymentMethod: PaymentMethod | null = sale ? paymentMethodRaw : null

  const consumption = await resolveSubscriptionConsumption(orgId, loaded.order, sale)
  if (typeof consumption === 'string') return { ok: false, error: consumption }

  const closedAt = new Date().toISOString()
  const totals = computeOrderTotals(loaded.order.items, loaded.order.discountCents)

  const commissions = await buildOrderCommissions({
    orgId,
    orderId,
    items: loaded.order.items,
    paymentMethod,
    closedAt,
  })

  const sagaErr = await emitCloseOrderSaga({
    orgId,
    actorUid: r.ctx.session.uid,
    orderId,
    order: loaded.order,
    paymentMethod,
    totals,
    closedAt,
    consumption,
    commissions,
    security: await resolveWriteSecurity(r.ctx.membership, loaded.order.unitId),
  })
  if (sagaErr) return { ok: false, error: sagaErr }

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  revalidatePath('/agenda')
  revalidatePath('/reports')
  return { ok: true, orderId, commissionsGenerated: commissions.length }
}

export async function undoCloseOrder(orderId: string): Promise<OrderMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const order = await loadOrderById(r.ctx.membership.orgId, orderId)
  if (!order) return { ok: false, error: 'Venda não encontrada' }
  if (order.status !== 'closed') {
    return { ok: false, error: 'Só uma venda fechada pode ser desfeita' }
  }

  const closedAtMs = order.closedAt ? Date.parse(order.closedAt) : Number.NaN
  if (Number.isNaN(closedAtMs) || Date.now() - closedAtMs > UNDO_CLOSE_WINDOW_MS) {
    return { ok: false, error: 'A janela de 5 minutos para desfazer o fechamento expirou' }
  }

  const now = new Date().toISOString()
  const orgId = r.ctx.membership.orgId

  const commissions = await loadCommissionsForOrder(orgId, orderId)

  const paidCommission = commissions.find((c) => liquidationStatusOf(c) === 'pago')
  if (paidCommission) {
    return {
      ok: false,
      error: 'Não é possível reabrir: há comissão já paga vinculada a esta venda',
    }
  }

  const sale = await loadSaleMovementForOrder(orgId, orderId)

  let subscriptionRestore: { id: string; amount: number } | null = null
  const coveredQty = coveredItemQuantity(order.items)
  if (coveredQty > 0 && order.customerId) {
    const subId = await loadActiveSubscriptionId(orgId, order.customerId)
    if (subId) subscriptionRestore = { id: subId, amount: coveredQty }
  }

  const stockRestores = stockDecrementTargets(order.items)

  let cashReversal: { movement: CashMovement } | null = null
  if (sale) {
    const reversalId = newId()
    cashReversal = {
      movement: {
        id: reversalId,
        orgId,
        unitId: sale.unitId,
        kind: 'sale_reversal',
        direction: 'out',
        amountCents: sale.amountCents,
        paymentMethod: sale.paymentMethod,
        description: 'Estorno — fechamento desfeito',
        orderId,
        expenseCategoryId: null,
        recordedByUid: r.ctx.session.uid,
        createdAt: now,
      },
    }
  }

  const undoErr = await emitUndoClose({
    orgId,
    actorUid: r.ctx.session.uid,
    order,
    subscriptionRestore,
    stockRestores,
    cashReversal,
    commissionIds: commissions.map((c) => c.id),
    reopen: {
      reopenedAt: now,
      reversedClosedAt: order.closedAt ?? now,
      reversedRevenueCents: recognizedSaleRevenueCents(order.items),
      unitId: order.unitId,
      commissionsReversed: commissions.length,
      cashReversalMovementId: cashReversal?.movement.id ?? null,
      subscriptionRestored: subscriptionRestore !== null,
    },
  })
  if (undoErr) return { ok: false, error: undoErr }

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  revalidatePath('/agenda')
  revalidatePath('/reports')
  return { ok: true, orderId }
}

export async function closeOrderFormAction(
  _prev: CloseOrderFormState,
  formData: FormData,
): Promise<CloseOrderFormState> {
  const orderId = formData.get('orderId')
  if (typeof orderId !== 'string' || orderId.length === 0) {
    return { ok: false, error: 'Venda não informada' }
  }
  const res = await closeOrder(orderId, formData)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

export async function undoCloseOrderFormAction(
  _prev: UndoCloseOrderFormState,
  formData: FormData,
): Promise<UndoCloseOrderFormState> {
  const orderId = formData.get('orderId')
  if (typeof orderId !== 'string' || orderId.length === 0) {
    return { ok: false, error: 'Venda não informada' }
  }
  const res = await undoCloseOrder(orderId)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
