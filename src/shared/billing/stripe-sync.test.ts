import type * as Log from '@cbrl/log'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrgBilling: vi.fn(),
  listUnitsForOrg: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  logError: vi.fn<Log.Logger['error']>(),
}))

vi.mock('@/shared/billing/stripe-client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: mocks.retrieve, update: mocks.update },
  }),
}))
vi.mock('@/shared/org/billing-read', () => ({ getOrgBilling: mocks.getOrgBilling }))
vi.mock('@/shared/org/unit-read', () => ({ listUnitsForOrg: mocks.listUnitsForOrg }))
vi.mock('@cbrl/log', async (importOriginal) => ({
  ...(await importOriginal<typeof Log>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.logError },
}))

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
    const errSpy = mocks.logError

    await expect(syncStripeSubscriptionQuantity('org-1')).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalledWith(
      'failed',
      expect.objectContaining({ scope: 'syncStripeSubscriptionQuantity', orgId: 'org-1' }),
    )
    const meta = errSpy.mock.calls[0]?.[1]
    expect(meta?.err).toBeInstanceOf(Error)
  })

  it('does not throw when the subscription has no items', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(3))
    mocks.retrieve.mockResolvedValue({ id: 'sub_1', items: { data: [] } })

    await syncStripeSubscriptionQuantity('org-1')

    expect(mocks.update).not.toHaveBeenCalled()
  })
})
