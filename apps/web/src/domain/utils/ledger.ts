import type { Charge } from '@/domain/types/charge'
import type { Commission } from '@/domain/types/commission'
import { type LedgerEntry, type LedgerNature } from '@/domain/types/ledger'
import { coverageOf, type OrderItem } from '@/domain/types/order'
import { computeItemLineTotal } from '@/domain/utils/order'
import { Money } from '@/domain/value-objects'

export type LedgerFact =
  | { readonly kind: 'order_closed'; readonly order: ClosedOrderFact }
  | { readonly kind: 'order_reopened'; readonly reopen: OrderReopenedFact }
  | { readonly kind: 'commission'; readonly commission: Commission }
  | { readonly kind: 'charge_succeeded'; readonly charge: Charge }
  | { readonly kind: 'charge_refunded'; readonly charge: Charge }

export type ClosedOrderFact = {
  readonly id: string
  readonly orgId: string
  readonly unitId: string
  readonly closedAt: string
  readonly items: readonly OrderItem[]
}

export type OrderReopenedFact = {
  readonly orderId: string
  readonly orgId: string
  readonly unitId: string
  readonly reopenedAt: string
  readonly reversedClosedAt: string
  readonly reversedRevenueCents: number
}

type Direction = 'in' | 'out'

function entry(fields: {
  orgId: string
  unitId: string
  nature: LedgerNature
  behavior: 'variable' | 'fixed'
  link: 'item' | 'sale' | 'unit'
  amountCents: number
  direction: Direction
  source: LedgerEntry['source']
  sourceId: string
  itemId: string | null
  occurredAt: string
}): LedgerEntry {
  const idParts = [fields.source, fields.sourceId, fields.itemId ?? undefined].filter(
    (p): p is string => p !== undefined,
  )
  return {
    id: idParts.join(':'),
    orgId: fields.orgId,
    unitId: fields.unitId,
    nature: fields.nature,
    behavior: fields.behavior,
    link: fields.link,
    amountCents: Money(Math.abs(fields.amountCents)),
    direction: fields.direction,
    source: fields.source,
    sourceId: fields.sourceId,
    itemId: fields.itemId,
    occurredAt: fields.occurredAt,
  }
}

export function recognizedSaleRevenueCents(items: readonly OrderItem[]): number {
  return items
    .filter((item) => coverageOf(item) === 'sale')
    .reduce((sum, item) => sum + computeItemLineTotal(item), 0)
}

function classifyClosedOrder(order: ClosedOrderFact): LedgerEntry[] {
  return order.items
    .filter((item) => coverageOf(item) === 'sale')
    .map((item) =>
      entry({
        orgId: order.orgId,
        unitId: order.unitId,
        nature: 'revenue',
        behavior: 'variable',
        link: 'item',
        amountCents: computeItemLineTotal(item),
        direction: 'in',
        source: 'order',
        sourceId: order.id,
        itemId: item.id,
        occurredAt: order.closedAt,
      }),
    )
}

function classifyCommission(
  commission: Commission,
  unitId: string,
  occurredAt: string,
): LedgerEntry[] {
  if (commission.amountCents <= 0) return []
  return [
    entry({
      orgId: commission.orgId,
      unitId,
      nature: 'csp',
      behavior: 'variable',
      link: 'item',
      amountCents: commission.amountCents,
      direction: 'out',
      source: 'commission',
      sourceId: commission.id,
      itemId: commission.orderItemId,
      occurredAt,
    }),
  ]
}

function classifyChargeRevenue(charge: Charge): LedgerEntry[] {
  if (charge.amountCents <= 0) return []
  return [
    entry({
      orgId: charge.orgId,
      unitId: charge.unitId,
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      amountCents: charge.amountCents,
      direction: 'in',
      source: 'charge',
      sourceId: charge.id,
      itemId: null,
      occurredAt: charge.periodStartAt,
    }),
  ]
}

function classifyChargeRefund(charge: Charge): LedgerEntry[] {
  if (charge.amountCents <= 0 || charge.refundedAt === null) return []
  return [
    entry({
      orgId: charge.orgId,
      unitId: charge.unitId,
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      amountCents: charge.amountCents,
      direction: 'out',
      source: 'charge',
      sourceId: `${charge.id}:refund`,
      itemId: null,
      occurredAt: charge.refundedAt,
    }),
  ]
}

function classifyOrderReopened(
  reopen: OrderReopenedFact,
  reversedRevenueCents: number,
): LedgerEntry[] {
  if (reversedRevenueCents <= 0) return []
  return [
    entry({
      orgId: reopen.orgId,
      unitId: reopen.unitId,
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      amountCents: reversedRevenueCents,
      direction: 'out',
      source: 'order',
      sourceId: `${reopen.orderId}:reopen:${reopen.reopenedAt}`,
      itemId: null,
      occurredAt: reopen.reopenedAt,
    }),
  ]
}

export function classifyLedger(facts: readonly LedgerFact[]): LedgerEntry[] {
  const closedByOrderId = new Map<string, ClosedOrderFact>()
  for (const fact of facts) {
    if (fact.kind === 'order_closed') closedByOrderId.set(fact.order.id, fact.order)
  }

  const entries: LedgerEntry[] = []
  for (const fact of facts) {
    switch (fact.kind) {
      case 'order_closed':
        entries.push(...classifyClosedOrder(fact.order))
        break
      case 'commission': {
        const order = closedByOrderId.get(fact.commission.orderId)
        if (!order) break
        entries.push(...classifyCommission(fact.commission, order.unitId, order.closedAt))
        break
      }
      case 'charge_succeeded':
        entries.push(...classifyChargeRevenue(fact.charge))
        break
      case 'charge_refunded':
        entries.push(...classifyChargeRefund(fact.charge))
        break
      case 'order_reopened':
        entries.push(...classifyOrderReopened(fact.reopen, fact.reopen.reversedRevenueCents))
        break
    }
  }
  return entries
}
