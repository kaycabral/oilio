import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrgBilling: vi.fn(),
  listUnitsForOrg: vi.fn(),
  retrieve: vi.fn(),
  createPreview: vi.fn(),
}))

vi.mock('@/shared/billing/stripe-client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: mocks.retrieve },
    invoices: { createPreview: mocks.createPreview },
  }),
}))
vi.mock('@/shared/org/billing-read', () => ({ getOrgBilling: mocks.getOrgBilling }))
vi.mock('@/shared/org/unit-read', () => ({ listUnitsForOrg: mocks.listUnitsForOrg }))
vi.mock('@/shared/billing/stripe-prices', () => ({
  stripePriceId: vi.fn(() => 'price_units'),
}))

import { getUnitAdditionCost } from './unit-cost-preview'

function billing(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId: 'org-1',
    tier: 'pro',
    billingCycle: 'monthly',
    unitQuantity: 1,
    stripeSubscriptionId: 'sub_1',
    ...over,
  }
}

function units(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `unit-${i}` }))
}

function prorationLine(amount: number): Record<string, unknown> {
  return { amount, parent: { subscription_item_details: { proration: true } } }
}

function recurringLine(amount: number): Record<string, unknown> {
  return { amount, parent: { subscription_item_details: { proration: false } } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUnitAdditionCost', () => {
  it('is not charged for an org without a Stripe subscription (free tier)', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ stripeSubscriptionId: null }))
    mocks.listUnitsForOrg.mockResolvedValue(units(0))
    await expect(getUnitAdditionCost('org-1')).resolves.toEqual({ charged: false })
    expect(mocks.createPreview).not.toHaveBeenCalled()
  })

  it('is not charged when the next unit is covered by the LIVE Stripe quantity', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(0))
    mocks.retrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', price: { id: 'price_units' }, quantity: 1 }] },
    })
    await expect(getUnitAdditionCost('org-1')).resolves.toEqual({ charged: false })
    expect(mocks.createPreview).not.toHaveBeenCalled()
  })

  it('charges when Stripe quantity is behind the local projection (stale webhook)', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 2 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(1))
    mocks.retrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', price: { id: 'price_units' }, quantity: 1 }] },
    })
    mocks.createPreview
      .mockResolvedValueOnce({ currency: 'brl', lines: { data: [recurringLine(4990)] } })
      .mockResolvedValueOnce({
        currency: 'brl',
        lines: { data: [prorationLine(1650), recurringLine(7980)] },
      })
    const result = await getUnitAdditionCost('org-1')
    expect(result.charged).toBe(true)
  })

  it('targets the units subscription item by price id, not items[0]', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(1))
    mocks.retrieve.mockResolvedValue({
      id: 'sub_1',
      items: {
        data: [
          { id: 'si_addon', price: { id: 'price_addon' }, quantity: 1 },
          { id: 'si_units', price: { id: 'price_units' }, quantity: 1 },
        ],
      },
    })
    mocks.createPreview
      .mockResolvedValueOnce({ currency: 'brl', lines: { data: [recurringLine(4990)] } })
      .mockResolvedValueOnce({
        currency: 'brl',
        lines: { data: [prorationLine(1650), recurringLine(7980)] },
      })
    await getUnitAdditionCost('org-1')
    expect(mocks.createPreview).toHaveBeenNthCalledWith(2, {
      subscription: 'sub_1',
      subscription_details: {
        items: [{ id: 'si_units', quantity: 2 }],
        proration_behavior: 'create_prorations',
      },
    })
  })

  it('previews delta-proration, monthly delta and new total for an additional unit', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(1))
    mocks.retrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', price: { id: 'price_units' }, quantity: 1 }] },
    })
    mocks.createPreview
      .mockResolvedValueOnce({
        currency: 'brl',
        lines: { data: [prorationLine(500), recurringLine(4990)] },
      })
      .mockResolvedValueOnce({
        currency: 'brl',
        lines: { data: [prorationLine(500), prorationLine(1650), recurringLine(7980)] },
      })

    await expect(getUnitAdditionCost('org-1')).resolves.toEqual({
      charged: true,
      preview: {
        prorationCents: 1650,
        newMonthlyDeltaCents: 2990,
        newTotalMonthlyCents: 7980,
        currency: 'brl',
      },
    })
    expect(mocks.createPreview).toHaveBeenNthCalledWith(2, {
      subscription: 'sub_1',
      subscription_details: {
        items: [{ id: 'si_1', quantity: 2 }],
        proration_behavior: 'create_prorations',
      },
    })
  })

  it('degrades to a null preview when Stripe is unavailable and projection says charged (AC-17)', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(1))
    mocks.retrieve.mockRejectedValue(new Error('stripe down'))

    await expect(getUnitAdditionCost('org-1')).resolves.toEqual({ charged: true, preview: null })
  })

  it('stays uncharged on Stripe failure when the projection says covered', async () => {
    mocks.getOrgBilling.mockResolvedValue(billing({ unitQuantity: 1 }))
    mocks.listUnitsForOrg.mockResolvedValue(units(0))
    mocks.retrieve.mockRejectedValue(new Error('stripe down'))

    await expect(getUnitAdditionCost('org-1')).resolves.toEqual({ charged: false })
  })
})
