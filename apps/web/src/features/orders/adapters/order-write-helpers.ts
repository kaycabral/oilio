// Internal write/saga helpers for the order actions — extracted from the
// 'use server' module to stay under the module-size gate. Not server actions;
// imperative-shell helpers the close/item actions compose.

import type { computeOrderTotals } from '@/domain'
import {
  type CashMovement,
  CatalogItem,
  type Commission,
  type LiquidationStatus,
  Membership,
  Order,
  type OrderItem,
  type OrderItemKind,
  type PaymentMethod,
  StoredProfessional,
  Subscription,
  accrueCommissionForItem,
  coverageOf,
  coveredItemQuantity,
  coveredProducts,
  isCatalogProduct,
  isItemCoveredBySubscription,
  isOperational,
  membershipDocId,
} from '@/domain'
import {
  AppointmentConfig,
  CashMovementConfig,
  CatalogItemConfig,
  CommissionConfig,
  OrderConfig,
  SubscriptionConfig,
} from '@/domain/aggregates'

import { recordSaleMovement } from '@/features/cash/adapters/sale-movement'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'

import { listTenantMembers } from '@/shared/tenant/membership'

export function genItemId(): string {
  // ID curto suficiente pra colisão ser improvável dentro de uma única
  // order (≤ ~50 items na prática). Não precisa ser UUID — Firestore.id
  // só importa para o documento da order, items são embarcados.
  return Math.random().toString(36).slice(2, 12)
}

// Coleção `appointments` permite só os statuses do tipo Appointment.
// `completed` é o destino final quando a order fecha; antes disso o
// agendamento fica `scheduled` (não tem estado "em andamento" — o link via
// order.appointmentId já marca que tem order aberta).

export async function loadOpenOrder(
  tenantRef: FirebaseFirestore.DocumentReference,
  orderId: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; order: Order } | string> {
  const ref = tenantRef.collection('orders').withConverter(fsConverter(Order)).doc(orderId)
  const snap = await ref.get()
  const order = snap.data()
  if (!order) return 'Venda não encontrada'
  if (order.status !== 'open') return 'Venda já foi fechada ou cancelada'
  return { ref, order }
}

// Snapshot puro do item a partir do doc JÁ LIDO (dentro da transação do guard,
// brief 0033 AC-08). Separa a leitura (transacional, no caller) da resolução
// (pura) pra a checagem de descontinuação + o snapshot de preço/comissão
// rodarem atômicos com o write. `archivedAt` set = descontinuado → rejeita
// (AC-08). Preço = `min(exibido, vigente)` (AC-09): nunca cobra mais que o
// exibido ao operador; quando o exibido não veio, cobra o vigente.
// AC-05 (brief 0030): "membro pode operar" generaliza o antigo
// `assertExecutorApproved` (que carregava um Professional por doc id e exigia
// aprovação). O alvo da atribuição agora é o `userId` de QUALQUER membro, então
// a validação é:
//
//   1. Existe membership ativa `{tid}_{userId}` no tenant, com papel operacional
//      (não `customer`), e — se a membership for unit-scoped — escopada à
//      unidade da venda.
//   2. Item de SERVIÇO mantém a trava mais estrita: SE existe a projeção
//      `Professional` para esse `userId`, ela precisa estar aprovada (preserva o
//      fluxo de serviço atual). Produto/venda avulsa NÃO exige Professional —
//      basta ser membro ativo (é o que destrava o varejo: recepção vende balcão).
//
// Mantém o comportamento de serviço intacto e destrava produto sem profissional
// aprovado.
export async function assertMemberCanOperate({
  tenantRef,
  tenantId,
  attributedUserId,
  kind,
  orderUnitId,
}: {
  tenantRef: FirebaseFirestore.DocumentReference
  tenantId: string
  attributedUserId: string
  kind: OrderItemKind
  orderUnitId: string
}): Promise<string | null> {
  if (!attributedUserId) return 'Membro atribuído é obrigatório'

  // Membership é top-level (`memberships/{tid}_{userId}`), não subcoleção do
  // tenant — derivável do path da venda via `membershipDocId`.
  const db = tenantRef.firestore
  const memSnap = await db
    .collection('memberships')
    .withConverter(fsConverter(Membership))
    .doc(membershipDocId(tenantId, attributedUserId))
    .get()
  const membership = memSnap.data()
  if (!membership) return 'Membro não encontrado neste negócio'
  if (membership.status !== 'active') return 'Membro não está ativo neste negócio'
  if (membership.role === 'customer') return 'Cliente não pode ser atribuído a um item'
  // Membership unit-scoped (recepção de uma unidade) só opera na própria unidade.
  if (membership.unitId && membership.unitId !== orderUnitId) {
    return 'Membro não opera nesta unidade'
  }

  // Trava de serviço (AC-05): só serviço exige Professional aprovado, e só quando
  // a projeção existe para esse membro. Sem projeção (ex.: membro que ainda não
  // virou profissional) o serviço fica bloqueado — fluxo de serviço inalterado.
  if (kind === 'service') {
    const profSnap = await tenantRef
      .collection('professionals')
      .withConverter(fsConverter(StoredProfessional))
      .where('userId', '==', attributedUserId)
      .limit(1)
      .get()
    const stored = profSnap.docs.map((d) => d.data())[0]
    if (!stored) return 'Serviço exige um profissional — membro sem cadastro de profissional'
    if (!isOperational(stored.operationalStatus)) {
      return `Profissional não operacional (status: ${stored.operationalStatus})`
    }
  }

  return null
}

// Cobertura por item (brief 0021 AC-03): marca um item como `sale` (venda) ou
// `subscription` (consumo do plano do cliente). Brief 0024: consumo cobre
// QUALQUER kind (serviço ou produto) desde que o item esteja no snapshot
// congelado da assinatura (`includedItemIds` + categoria expandida) e haja saldo.
// Recalcula totais (coberto sai do total a pagar) — event-first.
// Resolve a single item's subscription coverage at marking time (brief 0024,
// AC-04): the item must be in the frozen snapshot and the plan must have
// remaining balance (excluding this item, any kind). Returns the subscription id
// to attach, or an error message.
export async function resolveItemCoverageSubscription(
  tenantRef: FirebaseFirestore.DocumentReference,
  order: Order,
  target: OrderItem,
  idx: number,
): Promise<{ subscriptionId: string } | string> {
  // Venda avulsa anônima (brief 0030, AC-02) não tem cliente → sem assinatura.
  if (!order.customerId) return 'Venda sem cliente não pode consumir assinatura'
  const subsSnap = await tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .where('customerId', '==', order.customerId)
    .where('status', '==', 'active')
    .limit(1)
    .get()
  const sub = subsSnap.docs.map((d) => ({ ...d.data(), id: d.id }))[0]
  if (!sub) return 'Cliente não possui assinatura ativa'

  const itemSnap = await tenantRef
    .collection('catalog_items')
    .withConverter(fsConverter(CatalogItem))
    .doc(target.refId)
    .get()
  const catalogItem = itemSnap.data()
  if (!catalogItem) return 'Item não encontrado no catálogo'
  if (!isItemCoveredBySubscription(sub.plan, catalogItem)) {
    return 'Item não está coberto pelo plano do cliente'
  }

  // Saldo restante = limite − consumido − já coberto nesta comanda (exceto este).
  if (sub.plan.usageLimit.kind === 'count') {
    const alreadyCovered = coveredItemQuantity(order.items.filter((_, i) => i !== idx))
    const remaining = sub.plan.usageLimit.quantity - sub.currentPeriod.consumed - alreadyCovered
    if (remaining < target.quantity) return 'Assinatura sem saldo restante para cobrir este item'
  }
  return { subscriptionId: sub.id }
}

// Resolução de cobertura no consumo (brief 0024, AC-04): cada item coberto
// precisa estar no snapshot CONGELADO da assinatura (item explícito ou categoria
// de conveniência). Lê o `categoryId` vivo do catálogo. Retorna erro ou null.
export async function validateCoveredItems(
  tenantRef: FirebaseFirestore.DocumentReference,
  coveredItems: OrderItem[],
  plan: Subscription['plan'],
): Promise<string | null> {
  const catalogSnaps = await Promise.all(
    [...new Set(coveredItems.map((it) => it.refId))].map((refId) =>
      tenantRef
        .collection('catalog_items')
        .withConverter(fsConverter(CatalogItem))
        .doc(refId)
        .get(),
    ),
  )
  const categoryByRefId = new Map<string, string | null>()
  for (const snap of catalogSnaps) {
    const item = snap.data()
    if (!item) continue
    categoryByRefId.set(item.id, item.categoryId)
  }
  for (const it of coveredItems) {
    const categoryId = categoryByRefId.get(it.refId)
    if (categoryId === undefined) return `Item coberto "${it.name}" não está mais no catálogo`
    if (!isItemCoveredBySubscription(plan, { id: it.refId, categoryId })) {
      return `Item "${it.name}" não está coberto pelo plano do cliente`
    }
  }
  return null
}

type ConsumptionPlan = {
  subscriptionToConsume: { id: string; amount: number } | null
  stockDecrements: { refId: string; quantity: number }[]
}

// Consumo de assinatura por item (brief 0024, Grupo B): valida cobertura + saldo
// e resolve o que decrementar (cota + estoque dos produtos cobertos). Retorna o
// plano de consumo, ou uma mensagem de erro.
export async function resolveSubscriptionConsumption(
  tenantRef: FirebaseFirestore.DocumentReference,
  order: Order,
  sale: boolean,
): Promise<ConsumptionPlan | string> {
  const coveredQty = coveredItemQuantity(order.items)
  if (!sale && coveredQty === 0) return 'Venda sem itens de venda nem consumo de assinatura'
  if (coveredQty === 0) return { subscriptionToConsume: null, stockDecrements: [] }
  // Consumo exige cliente — venda avulsa anônima (brief 0030) nunca chega aqui.
  if (!order.customerId) return 'Venda sem cliente não pode consumir assinatura'
  const subsSnap = await tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .where('customerId', '==', order.customerId)
    .where('status', '==', 'active')
    .limit(1)
    .get()
  const sub = subsSnap.docs.map((d) => ({ ...d.data(), id: d.id }))[0]
  if (!sub) return 'Cliente não possui assinatura ativa para o consumo marcado'

  const coverErr = await validateCoveredItems(
    tenantRef,
    order.items.filter((it) => coverageOf(it) === 'subscription'),
    sub.plan,
  )
  if (coverErr) return coverErr

  if (sub.plan.usageLimit.kind === 'count') {
    const remaining = sub.plan.usageLimit.quantity - sub.currentPeriod.consumed
    if (remaining < coveredQty) {
      return `Saldo insuficiente: ${remaining} restante(s) no ciclo, consumo requer ${coveredQty}`
    }
  }
  return {
    subscriptionToConsume: { id: sub.id, amount: coveredQty },
    // Produtos cobertos baixam estoque/COGS (AC-05); serviços cobertos não.
    stockDecrements: coveredProducts(order.items),
  }
}

// Apura comissões no fechamento (brief 0022 #998): toda comissão nasce
// `pendente`. Identidade do profissional CONGELADA no doc (brief 0041 AC-11).
// Comanda 100% coberta (sem paymentMethod) não comissiona.
export async function buildOrderCommissions(args: {
  tenantId: string
  tenantRef: FirebaseFirestore.DocumentReference
  orderId: string
  items: OrderItem[]
  paymentMethod: PaymentMethod | null
  closedAt: string
}): Promise<Commission[]> {
  if (!args.paymentMethod) return []
  const memberNameByUserId = new Map(
    (await listTenantMembers(args.tenantId)).map((m) => [m.userId, m.name]),
  )
  const resolveMemberName = (userId: string): string => memberNameByUserId.get(userId) ?? ''

  const commissions: Commission[] = []
  for (const item of args.items) {
    const accrual = accrueCommissionForItem(item, resolveMemberName)
    if (!accrual) continue
    const commissionRef = args.tenantRef.collection('commissions').doc()
    commissions.push({
      id: commissionRef.id,
      tenantId: args.tenantId,
      orderId: args.orderId,
      orderItemId: accrual.orderItemId,
      attributedUserId: accrual.attributedUserId,
      attributedMemberName: accrual.attributedMemberName,
      itemKind: accrual.itemKind,
      itemName: accrual.itemName,
      itemTotalCents: accrual.itemTotalCents,
      commissionKind: accrual.commissionKind,
      commissionValue: accrual.commissionValue,
      amountCents: accrual.amountCents,
      liquidationStatus: 'pendente' satisfies LiquidationStatus,
      createdAt: args.closedAt,
    })
  }
  return commissions
}

// Produto coberto baixa estoque (brief 0024, AC-05): `catalog_item.updated` com
// o novo `stock` (event-first). Lê o estoque vivo no fechamento, clamp em 0.
export async function emitStockDecrements(
  tenantId: string,
  tenantRef: FirebaseFirestore.DocumentReference,
  actorUid: string,
  stockDecrements: { refId: string; quantity: number }[],
): Promise<string | null> {
  for (const dec of stockDecrements) {
    const itemSnap = await tenantRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .doc(dec.refId)
      .get()
    const item = itemSnap.data()
    if (!item) continue
    if (!isCatalogProduct(item)) continue
    const nextStock = Math.max(0, item.stock - dec.quantity)
    const stockUpdated = await emitEvent(
      CatalogItemConfig,
      `tenants/${tenantId}/catalog_items/${dec.refId}`,
      {
        _tag: 'catalog_item.updated',
        actorId: actorUid,
        payload: { changes: { stock: nextStock } },
      },
    )
    if (!stockUpdated.ok) return stockUpdated.error
  }
  return null
}

// Cascata-saga (#1026): cada aggregate emite seu evento em sequência (sem batch/
// dual-write). Ordem: consumo de assinatura → estoque → comissões → caixa →
// appointment.completed → order.closed (âncora, por último). Falha antes do
// order.closed deixa a comanda ABERTA (retento-ável). Retorna erro ou null.
export async function emitCloseOrderSaga(args: {
  tenantId: string
  tenantRef: FirebaseFirestore.DocumentReference
  actorUid: string
  orderId: string
  order: Order
  paymentMethod: PaymentMethod | null
  totals: ReturnType<typeof computeOrderTotals>
  closedAt: string
  consumption: ConsumptionPlan
  commissions: Commission[]
}): Promise<string | null> {
  const { tenantId, tenantRef, actorUid, orderId, order, paymentMethod, totals, closedAt } = args
  const { subscriptionToConsume, stockDecrements } = args.consumption

  if (subscriptionToConsume) {
    const consumed = await emitEvent(
      SubscriptionConfig,
      `tenants/${tenantId}/subscriptions/${subscriptionToConsume.id}`,
      {
        _tag: 'subscription.usage_incremented',
        actorId: actorUid,
        payload: { amount: subscriptionToConsume.amount },
      },
    )
    if (!consumed.ok) return consumed.error
  }

  const stockErr = await emitStockDecrements(tenantId, tenantRef, actorUid, stockDecrements)
  if (stockErr) return stockErr

  for (const commission of args.commissions) {
    const created = await emitEvent(
      CommissionConfig,
      `tenants/${tenantId}/commissions/${commission.id}`,
      { _tag: 'commission.created', actorId: actorUid, payload: { data: commission } },
    )
    if (!created.ok) return created.error
  }

  // Caixa sem sessão (brief 0015): só a parte vendida vira movimento `sale`.
  if (paymentMethod && totals.totalCents > 0) {
    const saleMovement = await recordSaleMovement({
      tenantId,
      unitId: order.unitId,
      orderId,
      amountCents: totals.totalCents,
      paymentMethod,
      actorUid,
    })
    if (!saleMovement.ok) return saleMovement.error
  }

  if (order.appointmentId) {
    const apptDone = await emitEvent(
      AppointmentConfig,
      `tenants/${tenantId}/appointments/${order.appointmentId}`,
      { _tag: 'appointment.completed', actorId: actorUid, payload: {} },
    )
    if (!apptDone.ok) return apptDone.error
  }

  const closed = await emitEvent(OrderConfig, `tenants/${tenantId}/orders/${orderId}`, {
    _tag: 'order.closed',
    actorId: actorUid,
    payload: {
      closedAt,
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      paymentMethod,
    },
  })
  if (!closed.ok) return closed.error

  return null
}

// Desfaz o fechamento de uma order dentro de 5 min por compensação
// ES-consistente: nunca deleta histórico do event store — reverte as projeções
// e *appenda* o que precisa ser apendado (movimento de estorno no caixa), e
// emite `order.reopened` carregando o diff. Owner/manager only (mexe em
// dinheiro). Atômico: tudo num único batch.
// Compensação event-first (cascata-saga #1026), em sequência — sem batch:
// appointment volta a `scheduled`, a cota da assinatura é restaurada
// (usage_incremented negativo), o estoque dos produtos cobertos é devolvido, o
// caixa ganha o estorno (`sale_reversal` standalone) e as comissões geradas no
// close são revertidas (`commission.deleted` + remoção da projeção). A âncora
// `order.reopened` é emitida pelo chamador, por último.
export async function emitUndoCompensation(args: {
  tenantId: string
  tenantRef: FirebaseFirestore.DocumentReference
  actorUid: string
  order: Order
  subscriptionRestore: { id: string; amount: number } | null
  stockRestores: { refId: string; quantity: number }[]
  cashReversal: { ref: FirebaseFirestore.DocumentReference; movement: CashMovement } | null
  commissionsSnap: FirebaseFirestore.QuerySnapshot<Commission>
}): Promise<void> {
  const { tenantId, tenantRef, actorUid, order, subscriptionRestore, cashReversal } = args

  if (order.appointmentId) {
    await emitEvent(AppointmentConfig, `tenants/${tenantId}/appointments/${order.appointmentId}`, {
      _tag: 'appointment.updated',
      actorId: actorUid,
      payload: { changes: { status: 'scheduled' } },
    })
  }
  if (subscriptionRestore) {
    await emitEvent(
      SubscriptionConfig,
      `tenants/${tenantId}/subscriptions/${subscriptionRestore.id}`,
      {
        _tag: 'subscription.usage_incremented',
        actorId: actorUid,
        payload: { amount: -subscriptionRestore.amount },
      },
    )
  }

  for (const restore of args.stockRestores) {
    const itemSnap = await tenantRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .doc(restore.refId)
      .get()
    const item = itemSnap.data()
    if (!item) continue
    if (!isCatalogProduct(item)) continue
    await emitEvent(CatalogItemConfig, `tenants/${tenantId}/catalog_items/${restore.refId}`, {
      _tag: 'catalog_item.updated',
      actorId: actorUid,
      payload: { changes: { stock: item.stock + restore.quantity } },
    })
  }

  if (cashReversal) {
    await emitEvent(
      CashMovementConfig,
      `tenants/${tenantId}/cash_movements/${cashReversal.movement.id}`,
      {
        _tag: 'cash_movement.created',
        actorId: actorUid,
        payload: { data: cashReversal.movement },
      },
    )
  }

  for (const doc of args.commissionsSnap.docs) {
    await emitEvent(CommissionConfig, `tenants/${tenantId}/commissions/${doc.id}`, {
      _tag: 'commission.deleted',
      actorId: actorUid,
      payload: {},
    })
    await doc.ref.delete().catch(() => undefined)
  }
}
