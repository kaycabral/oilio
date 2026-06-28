import type { Commission, Order } from '@/domain'
import { describe, expect, it } from 'vitest'
import { shapeCommissionsSection } from './commissions'

function makeCommission(partial: {
  id: string
  orderId: string
  attributedUserId: string
  attributedMemberName?: string
  amountCents?: number
  liquidationStatus?: 'pendente' | 'pago'
}): Commission {
  return {
    id: partial.id,
    orgId: 't1',
    orderId: partial.orderId,
    orderItemId: `${partial.id}-item`,
    attributedUserId: partial.attributedUserId,
    attributedMemberName: partial.attributedMemberName ?? '',
    itemKind: 'service',
    itemName: 'Corte',
    itemTotalCents: 10000,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: partial.amountCents ?? 5000,
    liquidationStatus: partial.liquidationStatus ?? 'pendente',
    paidAt: null,
    paymentProof: null,
    createdAt: '2026-03-10T12:00:00.000Z',
  }
}

function makeOrder(id: string, unitId: string): Order {
  return {
    id,
    orgId: 't1',
    unitId,
    customerId: null,
    appointmentId: null,
    status: 'closed',
    items: [],
    discountCents: 0,
    closedAt: '2026-03-10T12:00:00.000Z',
    paymentMethod: 'cash',
    subtotalCents: 10000,
    totalCents: 10000,
    createdAt: '2026-03-10T11:00:00.000Z',
    updatedAt: '2026-03-10T12:00:00.000Z',
  }
}

const MEMBERS = [
  { userId: 'u1', name: 'Ana' },
  { userId: 'u2', name: 'Bruno' },
]

describe('shapeCommissionsSection', () => {
  it('scopes commissions to the active unit via the order→unit map', () => {
    const orders = [makeOrder('o1', 'unitA'), makeOrder('o2', 'unitB')]
    const commissions = [
      makeCommission({ id: 'c1', orderId: 'o1', attributedUserId: 'u1' }),
      makeCommission({ id: 'c2', orderId: 'o2', attributedUserId: 'u2' }),
    ]
    const out = shapeCommissionsSection({
      members: MEMBERS,
      allCommissions: commissions,
      allClosedOrders: orders,
      unitId: 'unitA',
      memberFilter: null,
      statusFilter: null,
    })
    expect(out.commissions.map((c) => c.id)).toEqual(['c1'])
  })

  it('applies the member filter on top of unit scoping', () => {
    const orders = [makeOrder('o1', 'unitA')]
    const commissions = [
      makeCommission({ id: 'c1', orderId: 'o1', attributedUserId: 'u1' }),
      makeCommission({ id: 'c2', orderId: 'o1', attributedUserId: 'u2' }),
    ]
    const out = shapeCommissionsSection({
      members: MEMBERS,
      allCommissions: commissions,
      allClosedOrders: orders,
      unitId: 'unitA',
      memberFilter: 'u2',
      statusFilter: null,
    })
    expect(out.commissions.map((c) => c.id)).toEqual(['c2'])
  })

  it('applies the status filter', () => {
    const orders = [makeOrder('o1', 'unitA')]
    const commissions = [
      makeCommission({
        id: 'c1',
        orderId: 'o1',
        attributedUserId: 'u1',
        liquidationStatus: 'pago',
      }),
      makeCommission({
        id: 'c2',
        orderId: 'o1',
        attributedUserId: 'u1',
        liquidationStatus: 'pendente',
      }),
    ]
    const out = shapeCommissionsSection({
      members: MEMBERS,
      allCommissions: commissions,
      allClosedOrders: orders,
      unitId: 'unitA',
      memberFilter: null,
      statusFilter: 'pago',
    })
    expect(out.commissions.map((c) => c.id)).toEqual(['c1'])
  })

  it('prefers the snapshot member name over the live member list', () => {
    const orders = [makeOrder('o1', 'unitA')]
    const commissions = [
      makeCommission({
        id: 'c1',
        orderId: 'o1',
        attributedUserId: 'u1',
        attributedMemberName: 'Ana (revogada)',
      }),
    ]
    const out = shapeCommissionsSection({
      members: MEMBERS,
      allCommissions: commissions,
      allClosedOrders: orders,
      unitId: 'unitA',
      memberFilter: null,
      statusFilter: null,
    })
    expect(out.memberNameByUserId.u1).toBe('Ana (revogada)')
    // Member without a commission snapshot falls back to the live name.
    expect(out.memberNameByUserId.u2).toBe('Bruno')
  })

  it('filters covered attendances by the member filter', () => {
    // A closed order with two subscription-covered service items, one per
    // memberOperation, so `byMemberOperation` has both — the member filter then keeps
    // only the matching memberOperation's covered row.
    const coveredItem = (attributedUserId: string) => ({
      id: `it-${attributedUserId}`,
      kind: 'service' as const,
      refId: 'svc-1',
      name: 'Corte',
      quantity: 1,
      unitPriceCents: 5000,
      commission: null,
      attributedUserId,
      coverage: 'subscription' as const,
      subscriptionId: 'sub-1',
    })
    const order: Order = {
      ...makeOrder('o1', 'unitA'),
      items: [coveredItem('u1'), coveredItem('u2')],
    }

    const out = shapeCommissionsSection({
      members: MEMBERS,
      allCommissions: [],
      allClosedOrders: [order],
      unitId: 'unitA',
      memberFilter: 'u2',
      statusFilter: null,
    })
    expect(out.coveredByMember.map((r) => r.memberOperationId)).toEqual(['u2'])
  })
})
