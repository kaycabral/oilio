import { describe, expect, it } from 'vitest'

import type { OrderItem } from '../types/order'
import { computeOrderTotals, coveredItemQuantity, stockDecrementTargets } from './order'

function item(over: Partial<OrderItem> & Pick<OrderItem, 'id' | 'kind' | 'refId'>): OrderItem {
  return {
    name: over.name ?? 'Item',
    quantity: over.quantity ?? 1,
    unitPriceCents: over.unitPriceCents ?? 1000,
    commission: over.commission ?? null,
    attributedUserId: over.attributedUserId ?? 'p1',
    coverage: over.coverage ?? 'sale',
    subscriptionId: over.subscriptionId ?? null,
    ...over,
  }
}

const SERVICE_SALE = item({ id: 'i1', kind: 'service', refId: 'svc-corte', quantity: 1 })
const SERVICE_SUB = item({
  id: 'i2',
  kind: 'service',
  refId: 'svc-barba',
  quantity: 1,
  coverage: 'subscription',
  subscriptionId: 'sub-1',
})
const PRODUCT_SALE = item({ id: 'i3', kind: 'product', refId: 'prod-shampoo', quantity: 3 })
const PRODUCT_SUB = item({
  id: 'i4',
  kind: 'product',
  refId: 'prod-pomada',
  quantity: 2,
  coverage: 'subscription',
  subscriptionId: 'sub-1',
})
const ITEMS = [SERVICE_SALE, SERVICE_SUB, PRODUCT_SALE, PRODUCT_SUB]

describe('Invariantes de fechamento — estoque desacoplado de coverage (#B4)', () => {
  it('TODO produto baixa estoque; coverage não muda o conjunto de decremento', () => {
    expect(stockDecrementTargets(ITEMS)).toEqual([
      { refId: 'prod-shampoo', quantity: 3 },
      { refId: 'prod-pomada', quantity: 2 },
    ])
  })

  it('o mesmo produto baixa o mesmo estoque, seja `sale` ou `subscription`', () => {
    const asSale = item({
      id: 'x',
      kind: 'product',
      refId: 'prod-x',
      quantity: 4,
      coverage: 'sale',
    })
    const asSub = item({
      id: 'x',
      kind: 'product',
      refId: 'prod-x',
      quantity: 4,
      coverage: 'subscription',
      subscriptionId: 'sub-1',
    })
    expect(stockDecrementTargets([asSale])).toEqual(stockDecrementTargets([asSub]))
  })

  it('cota (coveredItemQuantity) continua governada por coverage — só cobertos contam', () => {
    expect(coveredItemQuantity(ITEMS)).toBe(3)
  })
})

describe('Invariante de simetria close/undo — o que baixa é o que devolve (#B4)', () => {
  it('o conjunto decrementado no fechamento é idêntico ao restaurado na reabertura', () => {
    const decremented = stockDecrementTargets(ITEMS)
    const restored = stockDecrementTargets(ITEMS)
    expect(restored).toEqual(decremented)
  })
})

describe('Invariante cross-entry — efeitos são função dos ITENS, não do caminho (#B4)', () => {
  it('estoque idêntico para a mesma cesta de produtos, venha do balcão ou do agendamento', () => {
    const balcaoItems = [
      item({ id: 'b1', kind: 'product', refId: 'prod-shampoo', quantity: 3 }),
      item({ id: 'b2', kind: 'product', refId: 'prod-pomada', quantity: 1 }),
    ]
    const agendaItems = [
      item({ id: 'a1', kind: 'product', refId: 'prod-shampoo', quantity: 3 }),
      item({ id: 'a2', kind: 'product', refId: 'prod-pomada', quantity: 1 }),
    ]
    expect(stockDecrementTargets(balcaoItems).map((d) => d.refId)).toEqual(
      stockDecrementTargets(agendaItems).map((d) => d.refId),
    )
    expect(stockDecrementTargets(balcaoItems)).toEqual(stockDecrementTargets(agendaItems))
  })

  it('receita idêntica para os mesmos itens de venda, independentemente do caminho', () => {
    const items = [PRODUCT_SALE, SERVICE_SALE]
    expect(computeOrderTotals(items, 0)).toEqual(computeOrderTotals([...items].reverse(), 0))
  })
})
