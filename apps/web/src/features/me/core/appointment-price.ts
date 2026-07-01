import { type Order, type OrderItem, computeOrderTotals, hasSaleItem } from '@/domain'

// Customer-history price label (#1329). The row shows what the customer really
// experienced, not the service's list price:
//
// - a still-scheduled appointment has no closed order yet → the price snapshot
//   is the best estimate of what they'll pay;
// - a completed appointment closed into an order → derive the real value from
//   that order: fully plan-covered (no sale item / nothing charged) reads
//   "Coberto pelo plano"; otherwise the amount actually charged (sale items,
//   after discount) — which can differ from the list price.
//
// Pure: takes the frozen snapshot + the optional closed order, returns the
// label. No I/O, no formatting policy beyond the shared BRL format.

const COVERED_LABEL = 'Coberto pelo plano'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function appointmentPriceLabel(input: {
  servicePriceCentsSnapshot: number
  // The order this appointment closed into, when it has one (completed path).
  // Null/absent for a scheduled appointment or a completed one with no linked
  // closed order (legacy / no-show flows) — then the snapshot stands.
  closedOrder: Pick<Order, 'items' | 'discountCents'> | null
}): string {
  const { closedOrder } = input
  if (!closedOrder) return formatBRL(input.servicePriceCentsSnapshot)

  const items: readonly OrderItem[] = closedOrder.items
  const { totalCents } = computeOrderTotals(items, closedOrder.discountCents)
  // Fully covered by the plan: no sale item, or the sale total came to zero.
  if (!hasSaleItem(items) || totalCents === 0) return COVERED_LABEL
  return formatBRL(totalCents)
}
