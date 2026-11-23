import { describe, expect, it } from 'vitest'
import type { Commission } from '../types/commission'
import type { Order, OrderItem } from '../types/order'
import {
  summarizeCommissions,
  summarizeCommissionsByMember,
  summarizeCoveredAttendances,
} from './commission-report'

function commission(partial: Partial<Commission>): Commission {
  return {
    id: 'c',
    orgId: 't',
    orderId: 'o',
    orderItemId: 'i',
    attributedUserId: 'p',
    attributedMemberName: 'Profissional Teste',
    itemKind: 'service',
    itemName: 'Corte',
    itemTotalCents: 5000,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: 2500,
    createdAt: '2026-09-08T00:00:00.000Z',
    ...partial,
  }
}

describe('summarizeCommissions', () => {
  it('agrega contagem e total por status', () => {
    const summary = summarizeCommissions([
      commission({ liquidationStatus: 'pendente', amountCents: 2500 }),
      commission({ liquidationStatus: 'pendente', amountCents: 1500 }),
      commission({ liquidationStatus: 'pago', amountCents: 1000 }),
    ])
    expect(summary.byStatus.pendente).toEqual({ count: 2, totalCents: 4000 })
    expect(summary.byStatus.pago).toEqual({ count: 1, totalCents: 1000 })
    expect(summary.totalCents).toBe(5000)
    expect(summary.count).toBe(3)
  })

  it('comissão sem liquidationStatus conta como pendente (migração)', () => {
    const summary = summarizeCommissions([commission({ amountCents: 700 })])
    expect(summary.byStatus.pendente).toEqual({ count: 1, totalCents: 700 })
  })

  it('vazio retorna zeros', () => {
    const summary = summarizeCommissions([])
    expect(summary.totalCents).toBe(0)
    expect(summary.count).toBe(0)
    expect(summary.byStatus.pendente).toEqual({ count: 0, totalCents: 0 })
  })
})

describe('summarizeCommissionsByMember', () => {
  it('agrupa pendente/pago + total por membro (attributedUserId)', () => {
    const rows = summarizeCommissionsByMember([
      commission({ attributedUserId: 'p1', liquidationStatus: 'pendente', amountCents: 2500 }),
      commission({ attributedUserId: 'p1', liquidationStatus: 'pago', amountCents: 1000 }),
      commission({ attributedUserId: 'p2', liquidationStatus: 'pendente', amountCents: 800 }),
    ])
    const p1 = rows.find((r) => r.attributedUserId === 'p1')!
    const p2 = rows.find((r) => r.attributedUserId === 'p2')!
    expect(rows).toHaveLength(2)
    expect(p1.byStatus.pendente).toEqual({ count: 1, totalCents: 2500 })
    expect(p1.byStatus.pago).toEqual({ count: 1, totalCents: 1000 })
    expect(p1.totalCents).toBe(3500)
    expect(p2.byStatus.pendente).toEqual({ count: 1, totalCents: 800 })
    expect(p2.totalCents).toBe(800)
  })

  it('agrupa comissão de membro não-profissional (recepção) por userId', () => {
    const rows = summarizeCommissionsByMember([
      commission({
        attributedUserId: 'reception-user',
        itemKind: 'product',
        itemName: 'Pomada',
        liquidationStatus: 'pendente',
        amountCents: 1200,
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.attributedUserId).toBe('reception-user')
    expect(rows[0]!.byStatus.pendente).toEqual({ count: 1, totalCents: 1200 })
  })

  it('vazio retorna lista vazia', () => {
    expect(summarizeCommissionsByMember([])).toEqual([])
  })
})

function orderItem(partial: Partial<OrderItem>): OrderItem {
  return {
    id: 'oi',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 5000,
    commission: null,
    attributedUserId: 'p1',
    ...partial,
  }
}

function order(items: OrderItem[]): Order {
  return {
    id: 'o',
    orgId: 't',
    unitId: 'u',
    customerId: 'cust',
    appointmentId: null,
    status: 'closed',
    items,
    discountCents: 0,
    closedAt: '2026-09-08T00:00:00.000Z',
    paymentMethod: 'pix',
    subtotalCents: 0,
    totalCents: 0,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  }
}

describe('summarizeCoveredAttendances', () => {
  it('conta serviços cobertos por assinatura e soma o valor de catálogo', () => {
    const report = summarizeCoveredAttendances([
      order([
        orderItem({ coverage: 'subscription', unitPriceCents: 5000, quantity: 1 }),
        orderItem({ coverage: 'subscription', unitPriceCents: 3000, quantity: 2 }),
      ]),
    ])
    const p1 = report.byMemberOperation.find((r) => r.memberOperationId === 'p1')!
    expect(p1.count).toBe(2)
    expect(p1.catalogValueCents).toBe(11000)
    expect(report.totalCount).toBe(2)
    expect(report.totalCatalogValueCents).toBe(11000)
  })

  it('exclui venda (sale) e produtos do relatório de cobertos', () => {
    const report = summarizeCoveredAttendances([
      order([
        orderItem({ coverage: 'sale', unitPriceCents: 4000 }),
        orderItem({ unitPriceCents: 4000 }),
        orderItem({ kind: 'product', coverage: 'subscription', unitPriceCents: 9000 }),
      ]),
    ])
    expect(report.totalCount).toBe(0)
    expect(report.totalCatalogValueCents).toBe(0)
    expect(report.byMemberOperation).toEqual([])
  })

  it('agrupa cobertos por profissional executor', () => {
    const report = summarizeCoveredAttendances([
      order([
        orderItem({ attributedUserId: 'p1', coverage: 'subscription', unitPriceCents: 5000 }),
        orderItem({ attributedUserId: 'p2', coverage: 'subscription', unitPriceCents: 7000 }),
      ]),
    ])
    expect(report.byMemberOperation).toHaveLength(2)
    expect(
      report.byMemberOperation.find((r) => r.memberOperationId === 'p1')!.catalogValueCents,
    ).toBe(5000)
    expect(
      report.byMemberOperation.find((r) => r.memberOperationId === 'p2')!.catalogValueCents,
    ).toBe(7000)
  })

  it('vazio retorna zeros', () => {
    const report = summarizeCoveredAttendances([])
    expect(report.totalCount).toBe(0)
    expect(report.totalCatalogValueCents).toBe(0)
    expect(report.byMemberOperation).toEqual([])
  })
})
