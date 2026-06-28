// Unit tests for `syncStripeSubscriptionQuantity` (brief 0073, AC-02) — the
// post-commit hook that keeps the Stripe subscription `quantity` aligned with the
// Negócio's active unit count. The load-bearing invariants:
//   - no-op when the org has no paid subscription (Free has no Stripe object);
//   - no-op when the count already matches (avoids a needless prorated charge);
//   - on drift, `stripe.subscriptions.update` is called with the new quantity and
//     `proration_behavior: 'create_prorations'`;
//   - it NEVER throws — a Stripe failure is swallowed (the reconcile cron is the
//     safety net), so the unit mutation that triggered it can't be rolled back.
//
// All three deps are mocked (no DB, no network), mirroring the canonical
// server-action unit pattern (subscriptions.actions.test).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrgBilling: vi.fn(),
  listUnitsForOrg: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/shared/billing/stripe-client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: mocks.retrieve, update: mocks.update },
  }),
}))
vi.mock('@/shared/org/billing-read', () => ({ getOrgBilling: mocks.getOrgBilling }))
vi.mock('@/shared/org/unit-read', () => ({ listUnitsForOrg: mocks.listUnitsForOrg }))

import { syncStripeSubscriptionQuantity } from './stripe-sync'

function billing(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'org-1',
    orgId: 'org-1',
    tier: 'pro',
    status: 'active',
    billingCycle: 'monthly',
    unitQuantity: 1,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function units(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `unit-${i}` }))
}

function subscriptionWithItem(itemId: string): unknown {
  return { id: 'sub_1', items: { data: [{ id: itemId }] } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('syncStripeSubscriptionQuantity', () => {
  it('no-ops when the org has no paid subscription (Free)', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeSubscriptionId: null, tier: 'free' }))

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.listUnitsForOrg).not.toHaveBeenCalled()
    expect(mocks.retrieve).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('no-ops when the unit count already matches the billed quantity', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 3 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(3))

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.retrieve).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('updates the subscription quantity with prorations when the count drifts up', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(4))
    mocks.retrieve.mockResolvedValue(subscriptionWithItem('si_abc'))
    mocks.update.mockResolvedValue({})

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.retrieve).toHaveBeenCalledWith('sub_1')
    expect(mocks.update).toHaveBeenCalledWith('sub_1', {
      items: [{ id: 'si_abc', quantity: 4 }],
      proration_behavior: 'create_prorations',
    })
  })

  it('updates downward too (unit archived → fewer billed units)', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 5 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(2))
    mocks.retrieve.mockResolvedValue(subscriptionWithItem('si_abc'))
    mocks.update.mockResolvedValue({})

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.update).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({ items: [{ id: 'si_abc', quantity: 2 }] }),
    )
  })

  it('floors quantity at 1 even when the org has zero units', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 3 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(0))
    mocks.retrieve.mockResolvedValue(subscriptionWithItem('si_abc'))
    mocks.update.mockResolvedValue({})

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.update).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({ items: [{ id: 'si_abc', quantity: 1 }] }),
    )
  })

  it('does not throw when Stripe fails (swallowed — cron is the safety net)', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(3))
    mocks.retrieve.mockRejectedValue(new Error('stripe down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(syncStripeSubscriptionQuantity('org-1')).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })

  it('does not throw when the subscription has no items', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(3))
    mocks.retrieve.mockResolvedValue({ id: 'sub_1', items: { data: [] } })

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.update).not.toHaveBeenCalled()
  })
})
