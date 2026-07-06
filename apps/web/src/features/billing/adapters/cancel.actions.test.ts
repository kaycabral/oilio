// Unit tests for the native cancellation server action (brief 0090, AC-09).
// Gated on the `canManageBilling` capability (owner-only preset, #1377); flips
// `cancel_at_period_end` on the Stripe subscription; the webhook projects the
// flag onto org_billing (covered by the webhook integration test). Proven here
// without network or DB (all deps mocked):
//   - capability gate (denied → error result, no Stripe call)
//   - "no subscription" guard (error result, no Stripe call)
//   - happy path (updates the subscription with cancel_at_period_end + emits the
//     confirmed funnel event)
//   - Stripe failure maps to a friendly error result

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // #1377 — billing gates on the `canManageBilling` capability, not `role ===`.
  guardCapability: vi.fn(),
  getOrgBilling: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  track: vi.fn(),
}))

vi.mock('@/shared/org/membership', () => ({ guardCapability: mocks.guardCapability }))
vi.mock('@/shared/org/billing-read', () => ({ getOrgBilling: mocks.getOrgBilling }))
vi.mock('@/shared/lib/track', () => ({ track: mocks.track }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn() } }))
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
    // Proves the gate is the CAPABILITY, not `role ===` (brief 0075 AC-01).
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
