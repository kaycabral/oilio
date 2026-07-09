import type { CommissionRule } from '../types/member-operation'
import { coverageOf, type Order, type OrderItem } from '../types/order'

export type OrderTotals = {
  subtotalCents: number
  totalCents: number
}

export function computeItemLineTotal(item: Pick<OrderItem, 'quantity' | 'unitPriceCents'>): number {
  return item.quantity * item.unitPriceCents
}

export function computeOrderTotals(
  items: readonly Pick<OrderItem, 'quantity' | 'unitPriceCents' | 'coverage'>[],
  discountCents: number,
): OrderTotals {
  const subtotalCents = items
    .filter((it) => coverageOf(it) === 'sale')
    .reduce((acc, it) => acc + computeItemLineTotal(it), 0)
  const totalCents = Math.max(0, subtotalCents - discountCents)
  return { subtotalCents, totalCents }
}

export function coveredServiceQuantity(
  items: readonly Pick<OrderItem, 'quantity' | 'kind' | 'coverage'>[],
): number {
  return items
    .filter((it) => it.kind === 'service' && coverageOf(it) === 'subscription')
    .reduce((acc, it) => acc + it.quantity, 0)
}

export function coveredItemQuantity(
  items: readonly Pick<OrderItem, 'quantity' | 'coverage'>[],
): number {
  return items
    .filter((it) => coverageOf(it) === 'subscription')
    .reduce((acc, it) => acc + it.quantity, 0)
}

export function stockDecrementTargets(
  items: readonly OrderItem[],
): { refId: string; quantity: number }[] {
  return items
    .filter((it) => it.kind === 'product')
    .map((it) => ({ refId: it.refId, quantity: it.quantity }))
}

export function hasSaleItem(items: readonly Pick<OrderItem, 'coverage'>[]): boolean {
  return items.some((it) => coverageOf(it) === 'sale')
}

export function computeCommissionAmountCents(itemTotalCents: number, rule: CommissionRule): number {
  if (rule.kind === 'percentage') {
    return Math.round((itemTotalCents * rule.value) / 100)
  }
  return rule.value
}

export function isOrderEditable(order: Pick<Order, 'status'>): boolean {
  return order.status === 'open'
}

export type CommissionAccrual = {
  orderItemId: string
  attributedUserId: string
  attributedMemberName: string
  itemKind: OrderItem['kind']
  itemName: string
  itemTotalCents: number
  commissionKind: CommissionRule['kind']
  commissionValue: number
  amountCents: number
}

export function accrueCommissionForItem(
  item: OrderItem,
  resolveMemberName: (userId: string) => string = () => '',
): CommissionAccrual | null {
  if (coverageOf(item) === 'subscription') return null
  if (!item.commission) return null
  const itemTotalCents = computeItemLineTotal(item)
  const amountCents = computeCommissionAmountCents(itemTotalCents, item.commission)
  if (amountCents <= 0) return null
  return {
    orderItemId: item.id,
    attributedUserId: item.attributedUserId,
    attributedMemberName: item.attributedUserId ? resolveMemberName(item.attributedUserId) : '',
    itemKind: item.kind,
    itemName: item.name,
    itemTotalCents,
    commissionKind: item.commission.kind,
    commissionValue: item.commission.value,
    amountCents,
  }
}
