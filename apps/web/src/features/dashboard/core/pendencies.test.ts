import { type Customer, type Order } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  COMANDA_STALE_HOURS,
  CUSTOMER_INACTIVE_DAYS,
  selectInactiveCustomerPendencies,
  selectOpenOrderPendencies,
} from './pendencies'

const NOW = new Date('2026-03-15T12:00:00.000Z')

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString()
}
function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString()
}

function makeOrder(p: Partial<Order> & { status: Order['status']; createdAt: string }): Order {
  const common = {
    id: 'c',
    orgId: 't',
    unitId: 'u',
    customerId: 'cust',
    appointmentId: null,
    items: [],
    discountCents: 0,
    subtotalCents: 0,
    totalCents: 0,
    updatedAt: p.createdAt,
    ...p,
  }
  return p.status === 'closed'
    ? {
        ...common,
        status: 'closed',
        closedAt: p.closedAt ?? p.createdAt,
        paymentMethod: p.paymentMethod ?? null,
      }
    : { ...common, status: p.status, closedAt: null, paymentMethod: null }
}

function makeCustomer(p: Partial<Customer> & { createdAt: string; updatedAt: string }): Customer {
  const base: Customer = {
    id: 'cust',
    orgId: 't',
    userId: 'user',
    name: 'Alice',
    whatsapp: '1',
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
  return { ...base, ...p }
}

describe('selectOpenOrderPendencies', () => {
  it('keeps only open orders older than the threshold', () => {
    const stale = makeOrder({
      id: 'old',
      status: 'open',
      createdAt: hoursAgo(48),
      totalCents: 5000,
    })
    const fresh = makeOrder({ id: 'new', status: 'open', createdAt: hoursAgo(2) })
    const closed = makeOrder({ id: 'done', status: 'closed', createdAt: hoursAgo(72) })
    const result = selectOpenOrderPendencies([stale, fresh, closed], NOW)
    expect(result.map((r) => r.id)).toEqual(['old'])
    expect(result[0]?.hoursOpen).toBe(48)
    expect(result[0]?.totalCents).toBe(5000)
  })

  it('orders results by hoursOpen descending (oldest first)', () => {
    const a = makeOrder({ id: 'a', status: 'open', createdAt: hoursAgo(30) })
    const b = makeOrder({ id: 'b', status: 'open', createdAt: hoursAgo(72) })
    const c = makeOrder({ id: 'c', status: 'open', createdAt: hoursAgo(48) })
    expect(selectOpenOrderPendencies([a, b, c], NOW).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns nothing when no order exceeds the threshold', () => {
    const c = makeOrder({
      id: 'c',
      status: 'open',
      createdAt: hoursAgo(COMANDA_STALE_HOURS - 1),
    })
    expect(selectOpenOrderPendencies([c], NOW)).toEqual([])
  })
})

describe('selectInactiveCustomerPendencies', () => {
  it('flags customers idle longer than the threshold (default 60d)', () => {
    const idle = makeCustomer({
      id: 'idle',
      name: 'Bob',
      createdAt: daysAgo(200),
      updatedAt: daysAgo(120),
    })
    const active = makeCustomer({
      id: 'active',
      name: 'Carol',
      createdAt: daysAgo(200),
      updatedAt: daysAgo(5),
    })
    const result = selectInactiveCustomerPendencies([idle, active], NOW)
    expect(result.map((r) => r.id)).toEqual(['idle'])
    expect(result[0]?.daysInactive).toBe(120)
  })

  it('does not flag brand-new customers as inactive', () => {
    // Created less than the threshold ago — too soon to consider "sumido".
    const fresh = makeCustomer({
      id: 'fresh',
      name: 'New',
      createdAt: daysAgo(10),
      updatedAt: daysAgo(10),
    })
    expect(selectInactiveCustomerPendencies([fresh], NOW)).toEqual([])
  })

  it('orders by daysInactive desc and respects the limit', () => {
    const customers = Array.from({ length: 10 }, (_, i) =>
      makeCustomer({
        id: `c${i}`,
        name: `C${i}`,
        createdAt: daysAgo(200),
        updatedAt: daysAgo(70 + i * 5),
      }),
    )
    const result = selectInactiveCustomerPendencies(customers, NOW, CUSTOMER_INACTIVE_DAYS, 3)
    expect(result.map((r) => r.id)).toEqual(['c9', 'c8', 'c7'])
  })
})
