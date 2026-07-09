import { type Order, type OrderItem, computeOrderTotals, hasSaleItem } from '@/domain'

const COVERED_LABEL = 'Coberto pelo plano'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function appointmentPriceLabel(input: {
  servicePriceCentsSnapshot: number
  closedOrder: Pick<Order, 'items' | 'discountCents'> | null
}): string {
  const { closedOrder } = input
  if (!closedOrder) return formatBRL(input.servicePriceCentsSnapshot)

  const items: readonly OrderItem[] = closedOrder.items
  const { totalCents } = computeOrderTotals(items, closedOrder.discountCents)
  if (!hasSaleItem(items) || totalCents === 0) return COVERED_LABEL
  return formatBRL(totalCents)
}
