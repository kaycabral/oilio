import {
  accrueCommissionForItem,
  type Commission,
  coverageOf,
  coveredItemQuantity,
  isItemCoveredBySubscription,
  isOperational,
  type LiquidationStatus,
  type Membership,
  type Order,
  type OrderItem,
  type OrderItemKind,
  type PaymentMethod,
  stockDecrementTargets,
  type Subscription,
} from '@/domain'
import { hasCapability } from '@/domain/billing/capabilities'
import type { ParsedAssignCustomer } from '@/features/orders/core/assign-customer-form'
import type { CoverageResult } from '@/features/orders/core/coverage-result'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'

import { getOrgTier } from '@/shared/org/billing-read'
import { getCustomerById } from '@/shared/org/customer-read'
import { getMemberOperationByUserId } from '@/shared/org/member-operation-read'
import {
  canActOnOwnedResource,
  getMembership,
  listOrgMembers,
  operatesFrontDesk,
} from '@/shared/org/membership'
import { resolveCustomerIdForWrite } from '@/shared/org/resolve-customer-for-write'
import { loadActiveSubscriptionForCustomer, loadOrderById } from './order-financial-read'

export function canOperateOpenOrder(membership: Membership, items: readonly OrderItem[]): boolean {
  if (operatesFrontDesk(membership)) return true
  return items.every((item) => item.attributedUserId === membership.userId)
}

export function denyIfNotOwnOrder(
  membership: Membership,
  items: readonly OrderItem[],
): { ok: false; error: string } | null {
  if (canOperateOpenOrder(membership, items)) return null
  return { ok: false, error: 'Você só pode editar comandas atribuídas a você' }
}

export function denyIfCannotAttributeTo(
  membership: Membership,
  attributedUserId: string,
): { ok: false; error: string } | null {
  if (canActOnOwnedResource(membership, attributedUserId)) return null
  return { ok: false, error: 'Você só pode atribuir itens a si mesmo' }
}

export function genItemId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export async function loadOpenOrder(
  orgId: string,
  orderId: string,
): Promise<{ order: Order } | string> {
  const order = await loadOrderById(orgId, orderId)
  if (!order) return 'Venda não encontrada'
  if (order.status !== 'open') return 'Venda já foi fechada ou cancelada'
  return { order }
}

export async function assertMemberCanOperate({
  orgId,
  attributedUserId,
  kind,
  orderUnitId,
}: {
  orgId: string
  attributedUserId: string
  kind: OrderItemKind
  orderUnitId: string
}): Promise<string | null> {
  if (!attributedUserId) return 'Membro atribuído é obrigatório'

  const membership = await getMembership(orgId, attributedUserId)
  if (!membership) return 'Membro não encontrado neste negócio'
  if (membership.status !== 'active') return 'Membro não está ativo neste negócio'
  if (membership.rlsUnitScope && membership.rlsUnitScope !== orderUnitId) {
    return 'Membro não opera nesta unidade'
  }

  if (kind === 'service') {
    const memberOperation = await getMemberOperationByUserId(orgId, attributedUserId)
    if (!memberOperation)
      return 'Serviço exige um profissional — membro sem cadastro de profissional'
    if (!isOperational(memberOperation.operationalStatus)) {
      return `Profissional não operacional (status: ${memberOperation.operationalStatus})`
    }
  }

  return null
}

type ItemCoverageInput = {
  orgId: string
  order: Order
  target: OrderItem
  idx: number
  catalogHint?: { id: string; categoryId: string | null }
}

export async function resolveItemCoverageSubscription(
  args: ItemCoverageInput,
): Promise<CoverageResult> {
  const { orgId, order, target, idx, catalogHint } = args
  if (!order.customerId) return { covered: false, reason: 'no_customer' }
  const sub = await loadActiveSubscriptionForCustomer(orgId, order.customerId)
  if (!sub) return { covered: false, reason: 'no_subscription' }

  const catalogItem = catalogHint ?? (await getCatalogItemById(orgId, target.refId))
  if (!catalogItem) return { covered: false, reason: 'not_in_catalog' }
  if (!isItemCoveredBySubscription(sub.plan, catalogItem)) {
    return { covered: false, reason: 'not_in_plan' }
  }

  if (sub.plan.usageLimit.kind === 'count') {
    const alreadyCovered = coveredItemQuantity(order.items.filter((_, i) => i !== idx))
    const remaining = sub.plan.usageLimit.quantity - sub.currentPeriod.consumed - alreadyCovered
    if (remaining < target.quantity) return { covered: false, reason: 'no_balance' }
  }
  return { covered: true, subscriptionId: sub.id }
}

export async function autoMarkCoverageDefault(args: ItemCoverageInput): Promise<CoverageResult> {
  const resolved = await resolveItemCoverageSubscription(args)
  if (resolved.covered) {
    args.target.coverage = 'subscription'
    args.target.subscriptionId = resolved.subscriptionId
  }
  return resolved
}

export async function resolveAssignedCustomerId(
  orgId: string,
  membership: Membership,
  parsed: ParsedAssignCustomer,
): Promise<{ customerId: string | null } | { error: string }> {
  if (parsed.mode === 'none') return { customerId: null }
  const resolved = await resolveCustomerIdForWrite(
    membership,
    parsed.mode === 'new'
      ? { customerId: null, newCustomer: parsed.newCustomer }
      : { customerId: parsed.customerId, newCustomer: null },
  )
  if (!resolved.ok) return { error: resolved.error }
  if (parsed.mode === 'existing') {
    const customer = await getCustomerById(orgId, resolved.customerId)
    if (!customer) return { error: 'Cliente não encontrado neste estabelecimento' }
  }
  return { customerId: resolved.customerId }
}

export async function reevaluateCoverageForItems(
  orgId: string,
  order: Order,
): Promise<OrderItem[]> {
  const next: OrderItem[] = []
  for (let idx = 0; idx < order.items.length; idx++) {
    const item = order.items[idx]!
    const resolved = await resolveItemCoverageSubscription({
      orgId,
      order: { ...order, items: [...next, ...order.items.slice(idx)] },
      target: item,
      idx,
    })
    if (resolved.covered) {
      next.push({ ...item, coverage: 'subscription', subscriptionId: resolved.subscriptionId })
    } else {
      next.push({ ...item, coverage: 'sale', subscriptionId: null })
    }
  }
  return next
}

export async function validateCoveredItems(
  orgId: string,
  coveredItems: OrderItem[],
  plan: Subscription['plan'],
): Promise<string | null> {
  const catalogItems = await Promise.all(
    [...new Set(coveredItems.map((it) => it.refId))].map((refId) =>
      getCatalogItemById(orgId, refId),
    ),
  )
  const categoryByRefId = new Map<string, string | null>()
  for (const item of catalogItems) {
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

export type ConsumptionPlan = {
  subscriptionToConsume: { id: string; amount: number } | null
  stockDecrements: { refId: string; quantity: number }[]
}

export async function resolveSubscriptionConsumption(
  orgId: string,
  order: Order,
  sale: boolean,
): Promise<ConsumptionPlan | string> {
  const coveredQty = coveredItemQuantity(order.items)
  if (!sale && coveredQty === 0) return 'Venda sem itens de venda nem consumo de assinatura'
  const stockDecrements = stockDecrementTargets(order.items)

  if (coveredQty === 0) return { subscriptionToConsume: null, stockDecrements }

  const tier = await getOrgTier(orgId)
  if (!hasCapability(tier, 'plans.recurring')) {
    return { subscriptionToConsume: null, stockDecrements }
  }
  if (!order.customerId) return 'Venda sem cliente não pode consumir assinatura'
  const sub = await loadActiveSubscriptionForCustomer(orgId, order.customerId)
  if (!sub) return 'Cliente não possui assinatura ativa para o consumo marcado'

  const coverErr = await validateCoveredItems(
    orgId,
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
    stockDecrements,
  }
}

export async function buildOrderCommissions(args: {
  orgId: string
  orderId: string
  items: OrderItem[]
  paymentMethod: PaymentMethod | null
  closedAt: string
}): Promise<Commission[]> {
  if (!args.paymentMethod) return []
  const tier = await getOrgTier(args.orgId)
  if (!hasCapability(tier, 'commissions')) return []
  const memberNameByUserId = new Map(
    (await listOrgMembers(args.orgId)).map((m) => [m.userId, m.name]),
  )
  const resolveMemberName = (userId: string): string => memberNameByUserId.get(userId) ?? ''

  const commissions: Commission[] = []
  for (const item of args.items) {
    const accrual = accrueCommissionForItem(item, resolveMemberName)
    if (!accrual) continue
    commissions.push({
      id: newId(),
      orgId: args.orgId,
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
