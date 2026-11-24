import { describe, expect, it } from 'vitest'
import {
  computeCommissionAmountCents,
  computeItemLineTotal,
  computeOrderTotals,
  coveredServiceQuantity,
  hasSaleItem,
  isOrderEditable,
} from './order'

describe('computeItemLineTotal', () => {
  it('multiplica quantity × unitPriceCents', () => {
    expect(computeItemLineTotal({ quantity: 3, unitPriceCents: 1500 })).toBe(4500)
  })

  it('retorna zero quando quantity é zero', () => {
    expect(computeItemLineTotal({ quantity: 0, unitPriceCents: 1500 })).toBe(0)
  })
})

describe('computeOrderTotals', () => {
  it('soma items e subtrai desconto', () => {
    const items = [
      { quantity: 1, unitPriceCents: 5000 },
      { quantity: 2, unitPriceCents: 1500 },
    ]
    expect(computeOrderTotals(items, 1000)).toEqual({
      subtotalCents: 8000,
      totalCents: 7000,
    })
  })

  it('total não fica negativo quando desconto > subtotal (#1319)', () => {
    const items = [{ quantity: 1, unitPriceCents: 1000 }]
    expect(computeOrderTotals(items, 5000)).toEqual({
      subtotalCents: 1000,
      totalCents: 0,
    })
  })

  it('zera ambos quando order vazia', () => {
    expect(computeOrderTotals([], 0)).toEqual({ subtotalCents: 0, totalCents: 0 })
  })

  it('exclui itens cobertos por assinatura do total a pagar (brief 0021 AC-05)', () => {
    const items = [
      { quantity: 1, unitPriceCents: 5000, coverage: 'subscription' as const },
      { quantity: 1, unitPriceCents: 3000, coverage: 'sale' as const },
      { quantity: 1, unitPriceCents: 2000 },
    ]
    expect(computeOrderTotals(items, 0)).toEqual({ subtotalCents: 5000, totalCents: 5000 })
  })

  it('total zero quando 100% coberto pela assinatura', () => {
    const items = [{ quantity: 1, unitPriceCents: 5000, coverage: 'subscription' as const }]
    expect(computeOrderTotals(items, 0)).toEqual({ subtotalCents: 0, totalCents: 0 })
  })
})

describe('coveredServiceQuantity', () => {
  it('soma só serviços cobertos; produtos e vendas não contam', () => {
    const items = [
      { quantity: 2, kind: 'service' as const, coverage: 'subscription' as const },
      { quantity: 1, kind: 'service' as const, coverage: 'sale' as const },
      { quantity: 3, kind: 'product' as const, coverage: 'subscription' as const },
    ]
    expect(coveredServiceQuantity(items)).toBe(2)
  })
})

describe('hasSaleItem', () => {
  it('true quando há item de venda (default sem campo)', () => {
    expect(hasSaleItem([{ coverage: 'subscription' as const }, {}])).toBe(true)
  })
  it('false quando todos cobertos', () => {
    expect(hasSaleItem([{ coverage: 'subscription' as const }])).toBe(false)
  })
})

describe('computeCommissionAmountCents', () => {
  it('percentage: aplica % sobre o total do item', () => {
    expect(computeCommissionAmountCents(10_000, { kind: 'percentage', value: 30 })).toBe(3000)
  })

  it('percentage: arredonda half-up', () => {
    expect(computeCommissionAmountCents(333, { kind: 'percentage', value: 50 })).toBe(167)
  })

  it('fixed: ignora preço do item e devolve valor literal', () => {
    expect(computeCommissionAmountCents(100_000, { kind: 'fixed', value: 500 })).toBe(500)
  })

  it('percentage zero produz zero', () => {
    expect(computeCommissionAmountCents(10_000, { kind: 'percentage', value: 0 })).toBe(0)
  })
})

describe('isOrderEditable', () => {
  it('open é editável', () => {
    expect(isOrderEditable({ status: 'open' })).toBe(true)
  })

  it('closed não é editável', () => {
    expect(isOrderEditable({ status: 'closed' })).toBe(false)
  })

  it('cancelled não é editável', () => {
    expect(isOrderEditable({ status: 'cancelled' })).toBe(false)
  })
})
