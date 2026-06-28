// Unit tests for `getOrgBilling` / `getOrgTier` / `freeOrgBilling` — the read
// seam the gating (feature C) consumes. The decisive behaviour is the
// DEFAULT-FREE fallback: a Negócio with no org_billing row must resolve to Free
// (brief 0071, AC-03) so the gating locks paid surfaces without a backfill
// migration. `readUnderRls` is mocked to return the projector-shaped rows (or
// none); the Effect Schema decode + rowToDoc run for real so the test proves the
// real row → doc decode, not a stub.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readUnderRls: vi.fn(),
}))

vi.mock('@/shared/db/pg/rls-read', () => ({ readUnderRls: mocks.readUnderRls }))

import { freeOrgBilling, getOrgBilling, getOrgTier } from './billing-read'

// A full org_billing projector row (snake_case, as SELECT * returns it). The
// projector's rowToDoc maps this to the domain doc shape.
function billingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id: 'org-1',
    id: 'org-1',
    last_event_version: 3,
    tier: 'pro',
    status: 'active',
    billing_cycle: 'monthly',
    unit_quantity: 2,
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_123',
    current_period_end: '2026-08-01T00:00:00.000Z',
    cancel_at_period_end: false,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  mocks.readUnderRls.mockReset()
})

describe('freeOrgBilling', () => {
  it('is the Free baseline: free/active, 1 unit, no Stripe object', () => {
    const free = freeOrgBilling('org-x')
    expect(free).toMatchObject({
      orgId: 'org-x',
      id: 'org-x',
      tier: 'free',
      status: 'active',
      billingCycle: null,
      unitQuantity: 1,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    })
  })
})

describe('getOrgBilling', () => {
  it('returns the real state when a row exists', async () => {
    mocks.readUnderRls.mockResolvedValue([billingRow()])

    const billing = await getOrgBilling('org-1')

    expect(billing.tier).toBe('pro')
    expect(billing.status).toBe('active')
    expect(billing.billingCycle).toBe('monthly')
    expect(billing.unitQuantity).toBe(2)
    expect(billing.stripeCustomerId).toBe('cus_123')
    expect(billing.stripeSubscriptionId).toBe('sub_123')
    expect(billing.cancelAtPeriodEnd).toBe(false)
  })

  it('falls back to Free when no row exists (no backfill — brief 0071 AC-03)', async () => {
    mocks.readUnderRls.mockResolvedValue([])

    const billing = await getOrgBilling('org-empty')

    expect(billing).toEqual(freeOrgBilling('org-empty'))
    expect(billing.tier).toBe('free')
  })

  it('reads org-scoped under RLS with the given orgId', async () => {
    mocks.readUnderRls.mockResolvedValue([])

    await getOrgBilling('org-scope')

    expect(mocks.readUnderRls).toHaveBeenCalledTimes(1)
    expect(mocks.readUnderRls.mock.calls[0]?.[0]).toBe('org-scope')
  })

  it('decodes a canceled, cancel-at-period-end annual row faithfully', async () => {
    mocks.readUnderRls.mockResolvedValue([
      billingRow({
        tier: 'advanced',
        status: 'canceled',
        billing_cycle: 'annual',
        cancel_at_period_end: true,
      }),
    ])

    const billing = await getOrgBilling('org-1')

    expect(billing.tier).toBe('advanced')
    expect(billing.status).toBe('canceled')
    expect(billing.billingCycle).toBe('annual')
    expect(billing.cancelAtPeriodEnd).toBe(true)
  })
})

describe('getOrgTier', () => {
  it('returns just the tier from the row', async () => {
    mocks.readUnderRls.mockResolvedValue([billingRow({ tier: 'advanced' })])
    expect(await getOrgTier('org-1')).toBe('advanced')
  })

  it('returns free when no row exists', async () => {
    mocks.readUnderRls.mockResolvedValue([])
    expect(await getOrgTier('org-empty')).toBe('free')
  })
})
