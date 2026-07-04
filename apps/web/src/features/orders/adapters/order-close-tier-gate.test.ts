// Conditional tier gate on the order-close saga effects (brief 0088 AC-02). The
// non-obvious vector: self-booking closes a comanda via the saga with no owner/
// manager session, so a Free org accrued subscription consumption + commissions
// for free. The gate is CONDITIONAL — it SUPPRESSES the effect, never aborts the
// comanda (the avulsa is the Free baseline). These unit tests stub the IO deps
// (tier + active-subscription/member reads) and assert: on Free the subscription
// is NOT consumed (and the active-subscription read is never even reached) and no
// commissions are built; on Pro the effects flow. Stock always decrements (it is
// coverage-independent, #B4).

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
  } as Order
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

    // Not an error string — the comanda is NOT aborted (Free baseline preserved).
    expect(typeof plan).not.toBe('string')
    if (typeof plan !== 'string') {
      // No quota debit.
      expect(plan.subscriptionToConsume).toBeNull()
    }
    // The gate short-circuits BEFORE the active-subscription read — no
    // materialization of the subscription for a Free org.
    expect(mocks.loadActiveSubscriptionForCustomer).not.toHaveBeenCalled()
  })

  it('Pro: passa do gate e resolve a assinatura ativa do cliente (fluxo completo no integration)', async () => {
    // On Pro the gate does NOT short-circuit — it proceeds to read the active
    // subscription. The full consume+validate happy path is proven end-to-end in
    // `close-order-saga-acid` integration; here we only assert the gate lets Pro
    // through to the read (the wall is tier, not a Pro block).
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
    // Suppressed before touching the member roster.
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
