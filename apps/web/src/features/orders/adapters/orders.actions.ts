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
import { parseAssignCustomerForm } from '@/features/orders/core/assign-customer-form'
import { coverageDenialMessage } from '@/features/orders/core/coverage-result'
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
  reevaluateCoverageForItems,
  resolveAssignedCustomerId,
  resolveItemCoverageSubscription,
} from './order-write-helpers'

export async function startAttendance(appointmentId: string): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId

  const appointment = await getAppointmentById(orgId, appointmentId)
  if (!appointment) return { ok: false, error: 'Agendamento não encontrado' }

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

  const existingOrderId = await findOpenOrderIdForAppointment(orgId, appointmentId)
  if (existingOrderId) {
    return { ok: true, orderId: existingOrderId }
  }

  const [service, memberOperation] = await Promise.all([
    getCatalogItemById(orgId, appointment.serviceId),
    getMemberOperationById(orgId, appointment.memberOperationId),
  ])
  if (!service) return { ok: false, error: 'Serviço do agendamento não encontrado' }
  if (!memberOperation) return { ok: false, error: 'Profissional do agendamento não encontrado' }

  const initialItem: OrderItem = {
    id: genItemId(),
    kind: 'service',
    refId: service.id,
    name: service.name,
    quantity: 1,
    unitPriceCents: appointment.servicePriceCentsSnapshot,
    commission: appointment.commissionSnapshot,
    attributedUserId: memberOperation.userId,
  }

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
  const coverage = await autoMarkCoverageDefault({
    orgId,
    order: candidateOrder,
    target: initialItem,
    idx: 0,
    catalogHint: service,
  })
  const autosetSubscriptionId = coverage.covered ? coverage.subscriptionId : null

  const totals = computeOrderTotals([initialItem], 0)
  const now = new Date().toISOString()
  const order: Order = {
    ...candidateOrder,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    createdAt: now,
    updatedAt: now,
  }
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

  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  if (!parsed.attributedUserId) parsed.attributedUserId = r.ctx.session.uid

  const attributionDenied = denyIfCannotAttributeTo(r.ctx.membership, parsed.attributedUserId)
  if (attributionDenied) return attributionDenied

  const operateError = await assertMemberCanOperate({
    orgId,
    attributedUserId: parsed.attributedUserId,
    kind: parsed.kind,
    orderUnitId: loaded.order.unitId,
  })
  if (operateError) return { ok: false, error: operateError }

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
  const autosetSubscriptionId = coverageResolved.covered ? coverageResolved.subscriptionId : null
  const coverageNotice =
    !coverageResolved.covered && coverageResolved.reason !== 'no_customer'
      ? coverageDenialMessage(coverageResolved.reason)
      : undefined

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
  return { ok: true, orderId, coverageNotice }
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
  const removed = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.item_removed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })
  if (!removed.ok) return { ok: false, error: removed.error }

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

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

  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

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
  const attributed = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.item_attribution_changed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })
  if (!attributed.ok) return { ok: false, error: attributed.error }

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
    if (!resolved.covered) {
      return { ok: false, error: coverageDenialMessage(resolved.reason) }
    }
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

export async function assignCustomerToOrder(
  orderId: string,
  formData: FormData,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const parsed = parseAssignCustomerForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  const resolvedId = await resolveAssignedCustomerId(orgId, r.ctx.membership, parsed)
  if ('error' in resolvedId) return { ok: false, error: resolvedId.error }
  const customerId = resolvedId.customerId

  const assigned = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.customer_assigned',
    actorId: r.ctx.session.uid,
    payload: { customerId },
  })
  if (!assigned.ok) return { ok: false, error: assigned.error }

  const reevaluated = await reevaluateCoverageForItems(orgId, { ...loaded.order, customerId })
  const patch = recalcAndPatch(reevaluated, loaded.order.discountCents)
  const changed = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.item_coverage_changed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })
  if (!changed.ok) return { ok: false, error: changed.error }

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

  const denied = denyIfNotOwnOrder(r.ctx.membership, loaded.order.items)
  if (denied) return denied

  const { subtotalCents } = computeOrderTotals(loaded.order.items, 0)
  if (discountCents > subtotalCents) {
    return { ok: false, error: 'Desconto não pode ser maior que o subtotal da venda' }
  }

  const patch = recalcAndPatch(loaded.order.items, discountCents)
  const updated = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.meta_updated',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function cancelOrder(orderId: string): Promise<OrderMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const orgId = r.ctx.membership.orgId
  const loaded = await loadOpenOrder(orgId, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const cancelled = await emitEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
    _tag: 'order.cancelled',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  if (!cancelled.ok) return { ok: false, error: cancelled.error }

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

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
