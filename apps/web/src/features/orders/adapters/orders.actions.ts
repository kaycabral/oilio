'use server'

import {
  CatalogItem,
  computeOrderTotals,
  coverageOf,
  type Order,
  type OrderCoverage,
  type OrderItem,
} from '@/domain'
import { CatalogItemConfig, OrderConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  parseItemForm,
  recalcAndPatch,
  snapshotCatalogItem,
} from '@/features/orders/core/order-helpers'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'
import { formString } from '@/shared/form-data'
import { track } from '@/shared/lib/track'
import { Effect } from 'effect'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { emitEvent, emitEventGuarded } from '@/shared/effect-bridge'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getAppointmentById } from '@/shared/org/appointment-read'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { canActOnOwnedResource, requireManagerCtx, requireOrgCtx } from '@/shared/org/membership'

import type { OrderMutationResult } from '@/features/orders/core/order-results'
import { findOpenOrderIdForAppointment } from './order-financial-read'
import {
  assertMemberCanOperate,
  autoMarkCoverageDefault,
  denyIfCannotAttributeTo,
  denyIfNotOwnOrder,
  genItemId,
  loadOpenOrder,
  resolveItemCoverageSubscription,
} from './order-write-helpers'

export async function startAttendance(appointmentId: string): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId

  const appointment = await getAppointmentById(orgId, appointmentId)
  if (!appointment) return { ok: false, error: 'Agendamento não encontrado' }

  // Own-resource (brief 0075, #1257): a self-scoped memberOperation only starts the
  // attendance of THEIR OWN appointment; the balcão (owner/manager/recepção)
  // starts any. Mirrors the agenda actions' own-resource wall.
  if (!canActOnOwnedResource(r.ctx.membership, appointment.memberOperatorUserId ?? '')) {
    return { ok: false, error: 'Você só pode iniciar os próprios atendimentos' }
  }

  if (appointment.status === 'cancelled') {
    return { ok: false, error: 'Agendamento cancelado — abra um novo' }
  }
  if (appointment.status === 'completed') {
    return { ok: false, error: 'Atendimento já concluído' }
  }
  if (appointment.status === 'no_show') {
    return { ok: false, error: 'Cliente marcado como ausente' }
  }

  // Idempotência: se já existe order aberta pra este agendamento, retorna
  // o ID dela em vez de criar outra. Evita duplo-click virar duas orders.
  const existingOrderId = await findOpenOrderIdForAppointment(orgId, appointmentId)
  if (existingOrderId) {
    return { ok: true, orderId: existingOrderId }
  }

  const [service, memberOperation] = await Promise.all([
    getCatalogItemById(orgId, appointment.serviceId),
    getMemberOperationById(orgId, appointment.memberOperationId),
  ])
  // Unified catalog read (brief 0023, #1004). Only id/name are pulled live —
  // the financial snapshot comes from the appointment, not the live item.
  if (!service) return { ok: false, error: 'Serviço do agendamento não encontrado' }
  if (!memberOperation) return { ok: false, error: 'Profissional do agendamento não encontrado' }

  // Snapshot-first: order inicial herda os valores que o appointment
  // gravou no commit (#875), não os live de Service. Owner mexer no
  // override depois do booking não retroage no histórico financeiro.
  const initialItem: OrderItem = {
    id: genItemId(),
    kind: 'service',
    refId: service.id,
    name: service.name,
    quantity: 1,
    unitPriceCents: appointment.servicePriceCentsSnapshot,
    commission: appointment.commissionSnapshot,
    // Atribuição por membro (brief 0030, AC-04): serviço de agendamento default
    // ao `userId` do profissional do appointment — NÃO o doc id de MemberOperation.
    attributedUserId: memberOperation.userId,
  }

  // Subscription-aware coverage default (brief 0079, AC-06). The appointment's
  // service is the primary case the DoD calls out: a subscriber's comanda born
  // from `Iniciar atendimento` must already read `Consumo do plano` when the plan
  // covers the service with balance — the operator never flips it. Not covered /
  // no balance / no customer → stays `sale`. Reuses the `service` row already
  // loaded above as the coverage hint, so no second catalog read.
  const orderId = newId()
  const candidateOrder: Order = {
    id: orderId,
    orgId,
    unitId: appointment.unitId,
    customerId: appointment.customerId,
    appointmentId,
    status: 'open',
    items: [initialItem],
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: 0,
    totalCents: 0,
    createdAt: '',
    updatedAt: '',
  }
  const autosetSubscriptionId = await autoMarkCoverageDefault({
    orgId,
    order: candidateOrder,
    target: initialItem,
    idx: 0,
    catalogHint: service,
  })

  const totals = computeOrderTotals([initialItem], 0)
  const now = new Date().toISOString()
  const order: Order = {
    ...candidateOrder,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: a comanda nasce de `order.created` carregando o snapshot
  // completo (a projeção escreve o doc — sem `ref.set` paralelo).
  const created = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.created',
    actorId: r.ctx.session.uid,
    payload: { data: order },
  })
  if (!created.ok) return { ok: false, error: created.error }

  if (autosetSubscriptionId) {
    track('order_item_coverage_autoset', {
      org_id: orgId,
      user_id: r.ctx.session.uid,
      order_id: orderId,
      item_ref_id: initialItem.refId,
      subscription_id: autosetSubscriptionId,
    })
  }

  revalidatePath('/agenda')
  revalidatePath('/orders')
  return { ok: true, orderId }
}

// Venda avulsa (brief 0030, AC-01): novo entrypoint que abre uma order SEM
// agendamento (`appointmentId: null`) e SEM cliente (`customerId: null`, AC-02).
// Espelha a emissão event-first do `startAttendance`, mas nasce vazia (sem item
// pré-populado) na unidade ativa do contexto (brief 0029). A atribuição de item
// por membro e o default de vendedor são da fatia seguinte (#1056) — aqui a
// venda só abre; os itens entram via `addItemToOrder`.
export async function createOrder(): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const { activeUnitId } = await resolveActiveUnit(r.ctx.membership)
  if (!activeUnitId) {
    return { ok: false, error: 'Nenhuma unidade ativa — crie uma unidade antes de vender' }
  }

  const orgId = r.ctx.membership.orgId
  const orderId = newId()
  const now = new Date().toISOString()
  const order: Order = {
    id: orderId,
    orgId,
    unitId: activeUnitId,
    // Venda anônima: sem cliente e sem agendamento (AC-01/AC-02).
    customerId: null,
    appointmentId: null,
    status: 'open',
    items: [],
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: 0,
    totalCents: 0,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: a venda nasce de `order.created` carregando o snapshot completo
  // (a projeção escreve o doc — sem `ref.set` paralelo). O snapshot generalizado
  // aceita `appointmentId: null` E `customerId: null` (brief 0030).
  const created = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.created',
    actorId: r.ctx.session.uid,
    payload: { data: order },
  })
  if (!created.ok) return { ok: false, error: created.error }

  revalidatePath('/orders')
  return { ok: true, orderId }
}

export async function addItemToOrder(
  orderId: string,
  formData: FormData,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const parsed = parseItemForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Own-resource (brief 0075, #1257): a self-scoped memberOperation can only edit a
  // comanda whose items are all theirs — never a colleague's.
  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  // Default esperto da atribuição (brief 0030, AC-04): item sem `attributedUserId`
  // explícito fica atribuído ao membro que opera (o `userId` do ator). Cobre o
  // caso de varejo — produto avulso vendido pela recepção atribui à recepção.
  if (!parsed.attributedUserId) parsed.attributedUserId = r.ctx.session.uid

  // Atribuição own-scope (brief 0075, #1267): `denyIfNotOwnOrder` acima protege a
  // comanda pelos ITENS existentes — uma comanda recém-aberta (zero itens) passa
  // vacuamente, então trava a ATRIBUIÇÃO em si (balcão → qualquer membro;
  // own-scoped → só a si mesmo).
  const attributionDenied = denyIfCannotAttributeTo(r.ctx.membership, parsed.attributedUserId)
  if (attributionDenied) return attributionDenied

  const operateError = await assertMemberCanOperate({
    orgId,
    attributedUserId: parsed.attributedUserId,
    kind: parsed.kind,
    orderUnitId: loaded.order.unitId,
  })
  if (operateError) return { ok: false, error: operateError }

  // Guard transacional de descontinuação + preço (brief 0033 AC-08/AC-09): a
  // leitura da definição (catalog_item — ativo + preço) acontece DENTRO da
  // transação que appenda `order.item_added`, travando o doc. Concorrência
  // otimista do Firestore fecha a corrida "descontinua/reprecifica em T / vende
  // em T+δ": se a definição mudou entre o load e o commit, a tx re-tenta e
  // re-lê o estado fresco. Descontinuado → rejeita; preço = min(exibido, vigente).
  // É leitura de definição pra guardar/snapshotar o WRITE de UM aggregate (a
  // order) — não é saga cross-aggregate.
  // Subscription-aware coverage default (brief 0079, AC-06/AC-07). When the
  // comanda belongs to a subscriber and the item is covered by the plan WITH
  // remaining balance, the item enters as `subscription` (Consumo do plano,
  // R$ 0,00) instead of the `sale` default — the operator no longer flips it by
  // hand. No customer / not covered / out of balance → stays `sale` (AC-07).
  //
  // Resolved BEFORE the guard: coverage depends only on the customer, the item
  // ref/quantity and the comanda's existing items — none of which the in-tx
  // catalog read changes (that read only re-snapshots price/discontinuation).
  // Keeping it out of the optimistic-lock transaction avoids extra I/O under the
  // lock; the authoritative balance guard still runs at close
  // (`validateCoveredItems`). The item id is fixed up front so the candidate
  // order the resolver sees matches the item the event appends.
  const newItemId = genItemId()
  const candidate: OrderItem = {
    id: newItemId,
    kind: parsed.kind,
    refId: parsed.refId,
    name: '',
    quantity: parsed.quantity,
    unitPriceCents: 0,
    commission: null,
    attributedUserId: parsed.attributedUserId,
  }
  const coverageResolved = await resolveItemCoverageSubscription({
    orgId,
    order: { ...loaded.order, items: [...loaded.order.items, candidate] },
    target: candidate,
    idx: loaded.order.items.length,
  })
  const autosetSubscriptionId =
    typeof coverageResolved === 'string' ? null : coverageResolved.subscriptionId

  const catalogRef = aggregateRef(CatalogItemConfig, orgId, parsed.refId)
  const added = await emitEventGuarded({
    config: OrderConfig,
    ref: aggregateRef(OrderConfig, orgId, orderId),
    actorId: r.ctx.session.uid,
    tag: 'order.item_added',
    guard: (reader) =>
      Effect.gen(function* () {
        const item = yield* reader.getDoc(catalogRef, CatalogItem)
        const itemBase = snapshotCatalogItem(item, parsed, loaded.order.unitId)
        if (typeof itemBase === 'string') {
          return { _tag: 'reject' as const, message: itemBase }
        }
        const newItem: OrderItem = { id: newItemId, ...itemBase }
        if (autosetSubscriptionId) {
          newItem.coverage = 'subscription'
          newItem.subscriptionId = autosetSubscriptionId
        }
        const items = [...loaded.order.items, newItem]
        const patch = recalcAndPatch(items, loaded.order.discountCents)
        return { _tag: 'ok' as const, payload: { changes: patch } }
      }),
  })
  if (!added.ok) return { ok: false, error: added.error }

  if (autosetSubscriptionId) {
    track('order_item_coverage_autoset', {
      org_id: orgId,
      user_id: r.ctx.session.uid,
      order_id: orderId,
      item_ref_id: parsed.refId,
      subscription_id: autosetSubscriptionId,
    })
  }

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

export async function removeItemFromOrder(
  orderId: string,
  itemId: string,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Own-resource (brief 0075, #1257): only the order's own memberOperation (or the
  // balcão) may remove items — never a colleague's comanda.
  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  const items = loaded.order.items.filter((it) => it.id !== itemId)
  if (items.length === loaded.order.items.length) {
    return { ok: false, error: 'Item não encontrado' }
  }
  if (items.length === 0) {
    return {
      ok: false,
      error: 'Venda precisa de pelo menos um item — cancele a venda em vez disso',
    }
  }

  const patch = recalcAndPatch(items, loaded.order.discountCents)
  // Event-first: `order.item_removed` carrega o patch recalculado.
  await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.item_removed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

// Re-atribui um item a outro membro (brief 0030, AC-04). `attributedUserId` é o
// `userId` global do membro (não doc id de MemberOperation). Valida que o membro
// pode operar (AC-05) com a trava por `kind` do item, e emite o evento renomeado
// `order.item_attribution_changed` carregando o patch recalculado.
export async function updateItemAttribution(
  orderId: string,
  itemId: string,
  attributedUserId: string,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }
  if (!attributedUserId.trim()) return { ok: false, error: 'Membro atribuído é obrigatório' }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Own-resource (brief 0075, #1257): a self-scoped memberOperation cannot
  // re-attribute a colleague's item (and cannot pull a colleague's item onto
  // themselves) — only the order's own memberOperation or the balcão may.
  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  // Atribuição own-scope (brief 0075, #1267): além de `denyIfNotOwnOrder` (que
  // protege a comanda pelos itens), trava o DESTINO da re-atribuição — um membro
  // own-scoped não pode empurrar o próprio item pra um colega; só o balcão
  // re-atribui a qualquer membro.
  const attributionDenied = denyIfCannotAttributeTo(r.ctx.membership, attributedUserId)
  if (attributionDenied) return attributionDenied

  const idx = loaded.order.items.findIndex((it) => it.id === itemId)
  if (idx < 0) return { ok: false, error: 'Item não encontrado' }
  const target = loaded.order.items[idx]!

  const operateError = await assertMemberCanOperate({
    orgId,
    attributedUserId,
    kind: target.kind,
    orderUnitId: loaded.order.unitId,
  })
  if (operateError) return { ok: false, error: operateError }

  const items = loaded.order.items.map((it, i) => (i === idx ? { ...it, attributedUserId } : it))
  const patch = recalcAndPatch(items, loaded.order.discountCents)
  // Event-first: `order.item_attribution_changed` carrega o patch recalculado.
  await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.item_attribution_changed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function updateItemCoverage(
  orderId: string,
  itemId: string,
  coverage: OrderCoverage,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Own-resource (brief 0075, #1257): only the order's own memberOperation (or the
  // balcão) may flip an item's coverage — never a colleague's comanda.
  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  const idx = loaded.order.items.findIndex((it) => it.id === itemId)
  if (idx < 0) return { ok: false, error: 'Item não encontrado' }
  const target = loaded.order.items[idx]!
  const from = coverageOf(target)

  let subscriptionId: string | null = null
  if (coverage === 'subscription') {
    const resolved = await resolveItemCoverageSubscription({
      orgId,
      order: loaded.order,
      target,
      idx,
    })
    if (typeof resolved === 'string') return { ok: false, error: resolved }
    subscriptionId = resolved.subscriptionId
  }

  const items = loaded.order.items.map((it, i) =>
    i === idx ? { ...it, coverage, subscriptionId } : it,
  )
  const patch = recalcAndPatch(items, loaded.order.discountCents)
  const changed = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.item_coverage_changed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })
  if (!changed.ok) return { ok: false, error: changed.error }

  // Operator overrode the suggested coverage (brief 0079, AC-08). Only a real,
  // PERSISTED change is an override — a no-op call (same coverage) doesn't fire,
  // and a failed append above already returned, so the analytics signal can't
  // count a change that never landed.
  if (from !== coverage) {
    track('order_item_coverage_overridden', {
      org_id: orgId,
      user_id: r.ctx.session.uid,
      order_id: orderId,
      item_ref_id: target.refId,
      from,
      to: coverage,
    })
  }

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function updateOrderMeta(
  orderId: string,
  formData: FormData,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const discountStr = formString(formData, 'discount').trim()
  const discountCents = Math.round(Number(discountStr.replace(',', '.')) * 100)
  if (!Number.isFinite(discountCents) || discountCents < 0) {
    return { ok: false, error: 'Desconto inválido' }
  }
  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Own-resource (brief 0075, #1257): a self-scoped memberOperation can't apply a
  // discount to a colleague's comanda — only its own memberOperation or the balcão.
  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  // Desconto não excede o subtotal vendável (#1319). Teto = subtotal só de itens
  // `sale` (itens cobertos por assinatura não compõem receita, então não podem
  // ser "descontados"). Reject com mensagem à recepção; o core ainda clampa o
  // total como defesa em profundidade (ver `computeOrderTotals`).
  const { subtotalCents } = computeOrderTotals(loaded.order.items, 0)
  if (discountCents > subtotalCents) {
    return { ok: false, error: 'Desconto não pode ser maior que o subtotal da venda' }
  }

  const patch = recalcAndPatch(loaded.order.items, discountCents)
  // Event-first: `order.meta_updated` carrega o patch (desconto + totais).
  await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.meta_updated',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function cancelOrder(orderId: string): Promise<OrderMutationResult> {
  // Cancelar é destrutivo (perde a venda) — restringe a owner/manager.
  const r = await requireManagerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Event-first: `order.cancelled` marca o status (a projeção escreve o doc).
  await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.cancelled',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

// Venda avulsa (brief 0030, AC-01): o botão "Nova venda" em /orders dispara via
// `<form action>`. Mesmo padrão redirect-on-success do `startAttendanceFormAction`
// — sem `useActionState` (o marker NEXT_REDIRECT não cruza o boundary de state).
export async function createOrderFormAction(): Promise<void> {
  const res = await createOrder()
  if (!res.ok) throw new Error(res.error)
  redirect(`/orders/${res.orderId}`)
}

export async function startAttendanceFormAction(formData: FormData): Promise<void> {
  const raw = formData.get('appointmentId')
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Agendamento não informado')
  }
  const res = await startAttendance(raw)
  if (!res.ok) throw new Error(res.error)
  redirect(`/orders/${res.orderId}`)
}
