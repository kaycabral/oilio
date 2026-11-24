import { describe, expect, it } from 'vitest'

import type { Charge } from '../types/charge'
import type { Commission } from '../types/commission'
import type { OrderItem } from '../types/order'
import { classifyLedger, type ClosedOrderFact, type LedgerFact } from './ledger'

function item(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'it1',
    kind: 'service',
    refId: 'svc1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 5000,
    commission: null,
    attributedUserId: 'u1',
    ...over,
  }
}

function closedOrder(items: OrderItem[], over: Partial<ClosedOrderFact> = {}): ClosedOrderFact {
  return {
    id: 'ord1',
    orgId: 't1',
    unitId: 'unit1',
    closedAt: '2026-07-01T13:00:00.000Z',
    items,
    ...over,
  }
}

function orderClosed(items: OrderItem[], over: Partial<ClosedOrderFact> = {}): LedgerFact {
  return { kind: 'order_closed', order: closedOrder(items, over) }
}

function commission(over: Partial<Commission> = {}): Commission {
  return {
    id: 'c1',
    orgId: 't1',
    orderId: 'ord1',
    orderItemId: 'it1',
    attributedUserId: 'u1',
    attributedMemberName: 'Alex',
    itemKind: 'service',
    itemName: 'Corte',
    itemTotalCents: 5000,
    commissionKind: 'percentage',
    commissionValue: 40,
    amountCents: 2000,
    createdAt: '2026-07-01T13:00:00.000Z',
    ...over,
  }
}

function charge(over: Partial<Charge> = {}): Charge {
  return {
    id: 'ch1',
    orgId: 't1',
    unitId: 'unit1',
    subscriptionId: 'sub1',
    customerId: 'cust1',
    amountCents: 8000,
    periodStartAt: '2026-07-01T00:00:00.000Z',
    periodEndAt: '2026-07-31T00:00:00.000Z',
    dueDate: '2026-07-05T00:00:00.000Z',
    status: 'paid',
    attempts: 1,
    paidAt: '2026-07-04T10:00:00.000Z',
    failedAt: null,
    failureReason: null,
    refundedAt: null,
    lastActorUid: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    ...over,
  }
}

describe('classifyLedger — venda avulsa (order.closed)', () => {
  it('mapeia cada item de venda a uma receita (in, variável, por item, competência=closedAt)', () => {
    const entries = classifyLedger([
      orderClosed([
        item({ id: 'a', quantity: 2, unitPriceCents: 3000 }),
        item({ id: 'b', quantity: 1, unitPriceCents: 5000 }),
      ]),
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      nature: 'revenue',
      behavior: 'variable',
      link: 'item',
      direction: 'in',
      amountCents: 6000,
      source: 'order',
      sourceId: 'ord1',
      itemId: 'a',
      unitId: 'unit1',
      occurredAt: '2026-07-01T13:00:00.000Z',
    })
    expect(entries[1]?.amountCents).toBe(5000)
  })

  it('exclui itens cobertos por assinatura (debitam o plano, não geram receita)', () => {
    const entries = classifyLedger([
      orderClosed([
        item({ id: 'sale', coverage: 'sale' }),
        item({ id: 'covered', coverage: 'subscription', subscriptionId: 'sub1' }),
      ]),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.itemId).toBe('sale')
  })

  it('item sem coverage é tratado como venda (migração implícita)', () => {
    expect(classifyLedger([orderClosed([item({ id: 'legacy' })])])).toHaveLength(1)
  })

  it('degenerado: comanda sem item de venda gera Razão vazio', () => {
    expect(
      classifyLedger([orderClosed([item({ coverage: 'subscription', subscriptionId: 's' })])]),
    ).toEqual([])
  })
})

describe('classifyLedger — comissão (CSP) herda unidade da comanda', () => {
  it('mapeia a comissão a um CSP (out, variável, por item) com unitId+competência da order correlata', () => {
    const entries = classifyLedger([
      orderClosed([item()], { id: 'ord1', unitId: 'unit-x', closedAt: '2026-07-01T13:00:00.000Z' }),
      { kind: 'commission', commission: commission({ orderId: 'ord1' }) },
    ])
    const csp = entries.find((e) => e.nature === 'csp')
    expect(csp).toMatchObject({
      nature: 'csp',
      behavior: 'variable',
      link: 'item',
      direction: 'out',
      amountCents: 2000,
      source: 'commission',
      itemId: 'it1',
      unitId: 'unit-x',
      occurredAt: '2026-07-01T13:00:00.000Z',
    })
  })

  it('comissão sem order.closed correlato na janela é ignorada (sem unidade fundamentável)', () => {
    const entries = classifyLedger([
      { kind: 'commission', commission: commission({ orderId: 'orphan' }) },
    ])
    expect(entries.filter((e) => e.nature === 'csp')).toEqual([])
  })

  it('degenerado: comissão de valor zero não gera entry', () => {
    const entries = classifyLedger([
      orderClosed([item()]),
      { kind: 'commission', commission: commission({ amountCents: 0 }) },
    ])
    expect(entries.filter((e) => e.nature === 'csp')).toEqual([])
  })
})

describe('classifyLedger — assinatura (charge) por competência do período', () => {
  it('reconhece a receita na competência do PERÍODO (periodStartAt), não no pagamento', () => {
    const entries = classifyLedger([{ kind: 'charge_succeeded', charge: charge() }])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      nature: 'revenue',
      behavior: 'variable',
      link: 'sale',
      direction: 'in',
      amountCents: 8000,
      source: 'charge',
      itemId: null,
      occurredAt: '2026-07-01T00:00:00.000Z',
    })
  })

  it('degenerado: charge de valor zero não gera entry', () => {
    expect(
      classifyLedger([{ kind: 'charge_succeeded', charge: charge({ amountCents: 0 }) }]),
    ).toEqual([])
  })
})

describe('classifyLedger — estorno por contrapartida (imutabilidade)', () => {
  it('charge.refunded gera contrapartida (revenue out) na competência do estorno (refundedAt)', () => {
    const entries = classifyLedger([
      {
        kind: 'charge_refunded',
        charge: charge({ status: 'refunded', refundedAt: '2026-08-10T09:00:00.000Z' }),
      },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      nature: 'revenue',
      direction: 'out',
      amountCents: 8000,
      source: 'charge',
      sourceId: 'ch1:refund',
      occurredAt: '2026-08-10T09:00:00.000Z',
    })
  })

  it('order.reopened estorna a receita reconhecida da comanda na competência do estorno', () => {
    const entries = classifyLedger([
      orderClosed([item({ id: 'a', quantity: 1, unitPriceCents: 5000 })], { id: 'ord1' }),
      {
        kind: 'order_reopened',
        reopen: {
          orderId: 'ord1',
          orgId: 't1',
          unitId: 'unit1',
          reopenedAt: '2026-08-05T10:00:00.000Z',
          reversedClosedAt: '2026-07-01T13:00:00.000Z',
          reversedRevenueCents: 5000,
        },
      },
    ])
    const reversal = entries.find((e) => e.direction === 'out')
    expect(reversal).toMatchObject({
      nature: 'revenue',
      direction: 'out',
      amountCents: 5000,
      source: 'order',
      unitId: 'unit1',
      occurredAt: '2026-08-05T10:00:00.000Z',
    })
    expect(entries.filter((e) => e.direction === 'in')).toHaveLength(1)
  })

  it('reopen cross-window (venda fechou fora da janela) AINDA estorna — valor+unidade do evento', () => {
    const entries = classifyLedger([
      {
        kind: 'order_reopened',
        reopen: {
          orderId: 'ord-prior-window',
          orgId: 't1',
          unitId: 'unit-x',
          reopenedAt: '2026-08-01T10:00:00.000Z',
          reversedClosedAt: '2026-07-31T23:59:00.000Z',
          reversedRevenueCents: 7000,
        },
      },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      nature: 'revenue',
      direction: 'out',
      amountCents: 7000,
      source: 'order',
      unitId: 'unit-x',
      occurredAt: '2026-08-01T10:00:00.000Z',
    })
  })

  it('reopen com receita reconhecida zero (só itens cobertos) não gera contrapartida', () => {
    const entries = classifyLedger([
      {
        kind: 'order_reopened',
        reopen: {
          orderId: 'ord-covered',
          orgId: 't1',
          unitId: 'unit1',
          reopenedAt: '2026-08-05T10:00:00.000Z',
          reversedClosedAt: '2026-07-01T13:00:00.000Z',
          reversedRevenueCents: 0,
        },
      },
    ])
    expect(entries).toEqual([])
  })
})
