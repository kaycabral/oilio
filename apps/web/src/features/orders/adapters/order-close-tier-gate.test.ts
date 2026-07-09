import type { Order, OrderItem } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrgTier: vi.fn<() => Promise<'free' | 'pro' | 'advanced'>>(),
  loadActiveSubscriptionForCustomer: vi.fn(),
  listOrgMembers: vi.fn<() => Promise<Array<{ userId: string; name: string; role?: string }>>>(),
}))

vi.mock('@/shared/org/billing-read', () => ({ getOrgTier: mocks.getOrgTier }))
vi.mock('./order-financial-read', () => ({
  loadActiveSubscriptionForCustomer: mocks.loadActiveSubscriptionForCustomer,
  loadOrderById: vi.fn(),
}))
vi.mock('@/shared/org/membership', () => ({ listOrgMembers: mocks.listOrgMembers }))

const { resolveSubscriptionConsumption, buildOrderCommissions } =
  await import('./order-write-helpers')

function coveredItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 5000,
    commission: { kind: 'percentage', value: 10 },
    attributedUserId: 'member-1',
    coverage: 'subscription',
    subscriptionId: null,
    ...overrides,
  }
}

function orderWith(items: OrderItem[]): Order {
  return {
    id: 'order-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    customerId: 'cust-1',
    appointmentId: null,
    items,
    discountCents: 0,
    subtotalCents: 5000,
    totalCents: 5000,
    status: 'open',
    closedAt: null,
    paymentMethod: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  }
}

describe('order close — conditional tier gate (brief 0088 AC-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadActiveSubscriptionForCustomer.mockResolvedValue(null)
    mocks.listOrgMembers.mockResolvedValue([])
  })

  it('Free: efeito de consumo suprimido — não consome nem materializa a assinatura', async () => {
    mocks.getOrgTier.mockResolvedValue('free')

    const plan = await resolveSubscriptionConsumption('org-1', orderWith([coveredItem()]), false)

    expect(typeof plan).not.toBe('string')
    if (typeof plan !== 'string') {
      expect(plan.subscriptionToConsume).toBeNull()
    }
    expect(mocks.loadActiveSubscriptionForCustomer).not.toHaveBeenCalled()
  })

  it('Pro: passa do gate e resolve a assinatura ativa do cliente (fluxo completo no integration)', async () => {
    mocks.getOrgTier.mockResolvedValue('pro')
    mocks.loadActiveSubscriptionForCustomer.mockResolvedValue(null)

    await resolveSubscriptionConsumption('org-1', orderWith([coveredItem()]), false)

    expect(mocks.loadActiveSubscriptionForCustomer).toHaveBeenCalledWith('org-1', 'cust-1')
  })

  it('Free: buildOrderCommissions não grava comissão (efeito suprimido)', async () => {
    mocks.getOrgTier.mockResolvedValue('free')

    const commissions = await buildOrderCommissions({
      orgId: 'org-1',
      orderId: 'order-1',
      items: [coveredItem({ coverage: 'sale' })],
      paymentMethod: 'cash',
      closedAt: '2026-06-01T12:00:00.000Z',
    })

    expect(commissions).toEqual([])
    expect(mocks.listOrgMembers).not.toHaveBeenCalled()
  })

  it('Pro: buildOrderCommissions apura a comissão do item', async () => {
    mocks.getOrgTier.mockResolvedValue('pro')
    mocks.listOrgMembers.mockResolvedValue([{ userId: 'member-1', name: 'Zé' }])

    const commissions = await buildOrderCommissions({
      orgId: 'org-1',
      orderId: 'order-1',
      items: [coveredItem({ coverage: 'sale' })],
      paymentMethod: 'cash',
      closedAt: '2026-06-01T12:00:00.000Z',
    })

    expect(commissions.length).toBeGreaterThan(0)
    expect(commissions[0]?.attributedUserId).toBe('member-1')
  })
})
