import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guardCapability: vi.fn(),
  getOrgBilling: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  track: vi.fn(),
}))

vi.mock('@/shared/org/membership', () => ({ guardCapability: mocks.guardCapability }))
vi.mock('@/shared/org/billing-read', () => ({ getOrgBilling: mocks.getOrgBilling }))
vi.mock('@/shared/lib/track', () => ({ track: mocks.track }))
vi.mock('@cbrl/log', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/shared/billing/stripe-client', () => ({
  getStripe: () => ({
    subscriptions: { update: mocks.subscriptionsUpdate },
  }),
}))

import { cancelSubscription } from './cancel.actions'

function ownerCtx() {
  return {
    ok: true as const,
    ctx: {
      session: { uid: 'owner-1' },
      membership: { orgId: 'org-1', role: 'owner' as const, userId: 'owner-1' },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cancelSubscription', () => {
  it('refuses when the billing capability is denied, gating on canManageBilling (#1377)', async () => {
    mocks.guardCapability.mockResolvedValue({ ok: false, error: 'Permission denied' })

    const res = await cancelSubscription()

    expect(res).toEqual({ ok: false, error: 'Permission denied' })
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
    expect(mocks.guardCapability).toHaveBeenCalledWith('canManageBilling')
  })

  it('errors when there is no active subscription', async () => {
    mocks.guardCapability.mockResolvedValue(ownerCtx())
    mocks.getOrgBilling.mockResolvedValue({ stripeSubscriptionId: null })

    const res = await cancelSubscription()

    expect(res.ok).toBe(false)
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('sets cancel_at_period_end and emits the confirmed event on success', async () => {
    mocks.guardCapability.mockResolvedValue(ownerCtx())
    mocks.getOrgBilling.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_123' })

    const res = await cancelSubscription()

    expect(res).toEqual({ ok: true })
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    })
    expect(mocks.track).toHaveBeenCalledWith('billing_cancel_confirmed', {
      org_id: 'org-1',
      user_id: 'owner-1',
    })
  })

  it('maps a Stripe failure to a friendly error result', async () => {
    mocks.guardCapability.mockResolvedValue(ownerCtx())
    mocks.getOrgBilling.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mocks.subscriptionsUpdate.mockRejectedValue(new Error('stripe down'))

    const res = await cancelSubscription()

    expect(res.ok).toBe(false)
    expect(mocks.track).not.toHaveBeenCalled()
  })
})
