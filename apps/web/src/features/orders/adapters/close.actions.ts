'use server'

import { formString } from '@/shared/form-data'
import { revalidatePath } from 'next/cache'

import {
  type CashMovement,
  type PaymentMethod,
  computeOrderTotals,
  coveredItemQuantity,
  coveredProducts,
  hasSaleItem,
  liquidationStatusOf,
} from '@/domain'
import { newId } from '@/shared/db/pg/new-id'

import { parsePaymentMethod, validateClosableItems } from '@/features/orders/core/order-helpers'

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
  loadOpenOrder,
  resolveSubscriptionConsumption,
} from './order-write-helpers'

const UNDO_CLOSE_WINDOW_MS = 5 * 60 * 1000

// Revalidate-only wrapper (Pattern B) — the close confirmation dialog needs the
// backend error surfaced inline without navigating, so `useActionState` consumes
// this and renders `state.error` inside the open dialog.
export type CloseOrderFormState = { ok: boolean; error?: string }
// Revalidate-only wrapper (Pattern B) — botão "Desfazer fechamento" do
// OrderDetail dispara via `<form action>`; erro (ex.: janela expirada) volta
// inline sem navegar.
export type UndoCloseOrderFormState = { ok: boolean; error?: string }

export async function closeOrder(orderId: string, formData: FormData): Promise<CloseOrderResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const paymentMethodRaw = parsePaymentMethod(formString(formData, 'paymentMethod'))

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const itemsErr = validateClosableItems(loaded.order.items)
  if (itemsErr) return { ok: false, error: itemsErr }

  // Fiscal-aware (brief 0021): forma de pagamento real é exigida só quando há
  // item de venda. Comanda 100% coberta por assinatura fecha SEM pagamento (AC-02/06).
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

  // AC-09: janela de 5 minutos a partir do fechamento.
  const closedAtMs = order.closedAt ? Date.parse(order.closedAt) : Number.NaN
  if (Number.isNaN(closedAtMs) || Date.now() - closedAtMs > UNDO_CLOSE_WINDOW_MS) {
    return { ok: false, error: 'A janela de 5 minutos para desfazer o fechamento expirou' }
  }

  const now = new Date().toISOString()
  const orgId = r.ctx.membership.orgId

  // Comissões geradas no close (projeção a remover do read model) — backend-aware.
  const commissions = await loadCommissionsForOrder(orgId, orderId)

  // AC-04 (brief 0022 #999): comissão já paga representa dinheiro repassado por
  // fora (Pix/dinheiro). Estorná-la silenciosamente perderia o registro do
  // pagamento, então a reabertura é BLOQUEADA enquanto houver comissão `pago`
  // vinculada — erro à mostra. Janela de 5 min ainda aberta + comissão já paga
  // é raro; quando ocorre, o owner decide explicitamente (não há undo cego).
  const paidCommission = commissions.find((c) => liquidationStatusOf(c) === 'pago')
  if (paidCommission) {
    return {
      ok: false,
      error: 'Não é possível reabrir: há comissão já paga vinculada a esta venda',
    }
  }

  // Movimento de venda original (existe só se havia caixa aberto no close) —
  // backend-aware.
  const sale = await loadSaleMovementForOrder(orgId, orderId)

  // Restaura a cota consumida pelos itens cobertos por assinatura (brief 0021
  // consumo por item via `coverage`; brief 0024 estende a produtos). Mesma
  // quantidade de itens cobertos (qualquer kind) debitada no close — revertida
  // event-first (usage_incremented negativo).
  let subscriptionRestore: { id: string; amount: number } | null = null
  const coveredQty = coveredItemQuantity(order.items)
  if (coveredQty > 0 && order.customerId) {
    const subId = await loadActiveSubscriptionId(orgId, order.customerId)
    if (subId) subscriptionRestore = { id: subId, amount: coveredQty }
  }

  // Devolve o estoque baixado pelos produtos cobertos no fechamento (brief 0024,
  // AC-05). Compensação event-first: `catalog_item.updated` somando de volta a
  // quantidade — espelha o decremento do close.
  const stockRestores = coveredProducts(order.items)

  // AC-08: estorno do caixa. Nunca deletamos o `sale` — appendamos um
  // `sale_reversal` standalone (brief 0015 — caixa sem sessão) que neta a venda.
  // O id é mintado localmente (UUID, backend-agnóstico).
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

  // Reverte (appointment/cota/estoque/caixa/comissões) + reabre. No Postgres, tudo
  // numa transação ACID única (AC-02); no Firestore, sequencial. A âncora
  // `order.reopened` (AC-10) faz parte da mesma operação.
  const undoErr = await emitUndoClose({
    orgId,
    actorUid: r.ctx.session.uid,
    order,
    subscriptionRestore,
    stockRestores,
    cashReversal,
    commissionIds: commissions.map((c) => c.id),
    reopen: {
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

// ── Form action wrappers (progressive enhancement) ───────────────────────────
//
// `<form action={…}>` submission lets the agenda dialog dispatch this server
// action without depending on hydration. The success path redirects to the
// new order — `redirect()` throws Next.js's internal `NEXT_REDIRECT` marker
// which the framework intercepts at the action boundary and turns into a
// client navigation; the agenda dialog dismounts naturally with no
// `router.push` call.
//
// **No `useActionState` wrapper on this one.** Wrapping a redirecting action
// in `useActionState` is unsupported in Next 16 — the `NEXT_REDIRECT` marker
// crosses the React state-update boundary and shows up as a server error in
// the dev/prod overlay. For redirect-on-success actions the canonical
// pattern is plain `<form action={fn}>` with `useFormStatus` inside the
// submit button for pending UI. Error feedback comes from a thrown Error
// (caught by the route's error boundary) or by inverting the design to
// `<form action={fn}>` + page-level revalidate (no redirect).

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
