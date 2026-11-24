import { type Order, type OrderItem, computeOrderTotals, hasSaleItem } from '@/domain'
import { formatBRLFromCents } from '@cbrl/br/money'

const COVERED_LABEL = 'Coberto pelo plano'

export function appointmentPriceLabel(input: {
  servicePriceCentsSnapshot: number
  closedOrder: Pick<Order, 'items' | 'discountCents'> | null
}): string {
  const { closedOrder } = input
  if (!closedOrder) return formatBRLFromCents(input.servicePriceCentsSnapshot)

  const items: readonly OrderItem[] = closedOrder.items
  const { totalCents } = computeOrderTotals(items, closedOrder.discountCents)
  if (!hasSaleItem(items) || totalCents === 0) return COVERED_LABEL
  return formatBRLFromCents(totalCents)
}
