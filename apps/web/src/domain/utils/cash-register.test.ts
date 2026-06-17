import { describe, expect, it } from 'vitest'
import type { CashMovement, CashMovementKind } from '../types/cash-movement'
import type { PaymentMethod } from '../types/order'
import { computeMovementTotals, getMovementDirection, isCashPaymentMethod } from './cash-register'

function movement(
  kind: CashMovementKind,
  amountCents: number,
  paymentMethod: PaymentMethod | null = null,
): CashMovement {
  const common = {
    id: 'm_' + Math.random().toString(36).slice(2, 8),
    tenantId: 't1',
    unitId: 'u1',
    amountCents,
    description: null,
    recordedByUid: 'user1',
    createdAt: '2026-05-14T12:00:00.000Z',
  }
  switch (kind) {
    case 'sale':
      return {
        ...common,
        kind,
        direction: 'in',
        orderId: 'o1',
        paymentMethod,
        expenseCategoryId: null,
      }
    case 'sale_reversal':
      return {
        ...common,
        kind,
        direction: 'out',
        orderId: 'o1',
        paymentMethod,
        expenseCategoryId: null,
      }
    case 'despesa':
      return {
        ...common,
        kind,
        direction: 'out',
        orderId: null,
        paymentMethod: null,
        expenseCategoryId: null,
      }
    case 'sangria':
      return {
        ...common,
        kind,
        direction: 'out',
        orderId: null,
        paymentMethod: null,
        expenseCategoryId: null,
      }
    case 'suprimento':
      return {
        ...common,
        kind,
        direction: 'in',
        orderId: null,
        paymentMethod: null,
        expenseCategoryId: null,
      }
  }
}

describe('getMovementDirection', () => {
  it('returns "in" for sale/suprimento', () => {
    expect(getMovementDirection('sale')).toBe('in')
    expect(getMovementDirection('suprimento')).toBe('in')
  })

  it('returns "out" for sangria/despesa/sale_reversal', () => {
    expect(getMovementDirection('sangria')).toBe('out')
    expect(getMovementDirection('despesa')).toBe('out')
    expect(getMovementDirection('sale_reversal')).toBe('out')
  })
})

describe('isCashPaymentMethod', () => {
  it('returns true only for cash', () => {
    expect(isCashPaymentMethod('cash')).toBe(true)
    expect(isCashPaymentMethod('pix')).toBe(false)
    expect(isCashPaymentMethod('credit_card')).toBe(false)
    expect(isCashPaymentMethod(null)).toBe(false)
  })
})

describe('computeMovementTotals', () => {
  it('returns zeros for empty list', () => {
    const t = computeMovementTotals([])
    expect(t.totalInCents).toBe(0)
    expect(t.totalOutCents).toBe(0)
    expect(t.cashInCents).toBe(0)
    expect(t.cashOutCents).toBe(0)
    expect(t.count).toBe(0)
    expect(t.salesByMethod.cash).toBe(0)
  })

  it('sale in cash affects cashIn; sale in pix does not', () => {
    const t = computeMovementTotals([movement('sale', 5000, 'cash'), movement('sale', 3000, 'pix')])
    expect(t.totalInCents).toBe(8000)
    expect(t.cashInCents).toBe(5000)
    expect(t.salesByMethod.cash).toBe(5000)
    expect(t.salesByMethod.pix).toBe(3000)
  })

  it('sangria/despesa decrease cash; suprimento increases cash', () => {
    const t = computeMovementTotals([
      movement('suprimento', 2000),
      movement('sangria', 500),
      movement('despesa', 1000),
    ])
    expect(t.cashInCents).toBe(2000)
    expect(t.cashOutCents).toBe(1500)
    expect(t.suprimentoCents).toBe(2000)
    expect(t.sangriaCents).toBe(500)
    expect(t.despesaCents).toBe(1000)
  })

  it('breaks down sales by method', () => {
    const t = computeMovementTotals([
      movement('sale', 1000, 'cash'),
      movement('sale', 2000, 'pix'),
      movement('sale', 3000, 'credit_card'),
      movement('sale', 500, 'debit_card'),
    ])
    expect(t.salesByMethod.cash).toBe(1000)
    expect(t.salesByMethod.pix).toBe(2000)
    expect(t.salesByMethod.credit_card).toBe(3000)
    expect(t.salesByMethod.debit_card).toBe(500)
  })

  it('sale_reversal nets out the sale by method and direction (#946)', () => {
    // Venda em cash + estorno em cash → salesByMethod.cash neta a zero e o
    // estorno sai como cashOut (reverte o drawer).
    const t = computeMovementTotals([
      movement('sale', 5000, 'cash'),
      movement('sale_reversal', 5000, 'cash'),
    ])
    expect(t.salesByMethod.cash).toBe(0)
    expect(t.cashInCents).toBe(5000)
    expect(t.cashOutCents).toBe(5000)
    expect(t.totalOutCents).toBe(5000)
  })

  it('sale/sale_reversal with null paymentMethod skip the per-method breakdown', () => {
    // Defensive: paymentMethod is nullable on the type. A sale without a method
    // still counts toward the in/out totals but never buckets into salesByMethod.
    const t = computeMovementTotals([movement('sale', 4000), movement('sale_reversal', 1000)])
    expect(t.totalInCents).toBe(4000)
    expect(t.totalOutCents).toBe(1000)
    expect(t.salesByMethod.cash).toBe(0)
    expect(t.salesByMethod.pix).toBe(0)
  })

  it('sale_reversal of a pix sale does not move the drawer', () => {
    // Estorno de venda pix: neta salesByMethod.pix, mas não mexe no caixa
    // físico (igual a venda pix original não mexeu).
    const t = computeMovementTotals([
      movement('sale', 3000, 'pix'),
      movement('sale_reversal', 3000, 'pix'),
    ])
    expect(t.salesByMethod.pix).toBe(0)
    expect(t.cashInCents).toBe(0)
    expect(t.cashOutCents).toBe(0)
    expect(t.totalOutCents).toBe(3000)
  })
})
