import type { EventMeta } from '@/domain/effect/event-store'
import { describe, expect, it } from 'vitest'

import type { OrgBillingEvent } from './events'
import { applyOrgBillingEvent } from './reducer'
import { INITIAL_ORG_BILLING_STATE, type OrgBillingState } from './types'

function meta(version: number, timestamp: string): EventMeta {
  return { version, timestamp, actorId: 'owner-1', schemaVersion: 1 }
}

const ACTIVATED_DATA = {
  id: 'org-1',
  orgId: 'org-1',
  tier: 'pro' as const,
  status: 'active' as const,
  billingCycle: 'monthly' as const,
  unitQuantity: 2,
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  currentPeriodEnd: '2026-07-27T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
}

describe('applyOrgBillingEvent', () => {
  it('activated overwrites the seed with the subscription state', () => {
    const next = applyOrgBillingEvent(
      INITIAL_ORG_BILLING_STATE,
      { _tag: 'org_billing.activated', data: ACTIVATED_DATA },
      meta(1, '2026-06-27T10:00:00.000Z'),
    )
    expect(next.tier).toBe('pro')
    expect(next.status).toBe('active')
    expect(next.unitQuantity).toBe(2)
    expect(next.stripeSubscriptionId).toBe('sub_123')
    expect(next._version).toBe(1)
    expect(next.createdAt).toBe('2026-06-27T10:00:00.000Z')
  })

  it('activated fills createdAt/updatedAt from meta when the data has empty timestamps', () => {
    // The webhook builds `data` off the Free default (createdAt/updatedAt = ''),
    // so the reducer must seed both from the stream meta — otherwise the
    // projection writes an empty string into a timestamptz column (regression,
    // brief 0074).
    const next = applyOrgBillingEvent(
      INITIAL_ORG_BILLING_STATE,
      {
        _tag: 'org_billing.activated',
        data: { ...ACTIVATED_DATA, createdAt: '', updatedAt: '' },
      },
      meta(1, '2026-06-27T10:00:00.000Z'),
    )
    expect(next.createdAt).toBe('2026-06-27T10:00:00.000Z')
    expect(next.updatedAt).toBe('2026-06-27T10:00:00.000Z')
  })

  it('updated as the FIRST event seeds createdAt from meta (no prior activation)', () => {
    // Stripe may deliver subscription.updated before checkout.session.completed;
    // the row is born here, so createdAt must come from meta, not stay '' from
    // the seed state (regression, brief 0074).
    const next = applyOrgBillingEvent(
      INITIAL_ORG_BILLING_STATE,
      {
        _tag: 'org_billing.updated',
        changes: { id: 'org-9', orgId: 'org-9', tier: 'pro', status: 'active' },
      },
      meta(1, '2026-06-27T10:00:00.000Z'),
    )
    expect(next.createdAt).toBe('2026-06-27T10:00:00.000Z')
    expect(next.updatedAt).toBe('2026-06-27T10:00:00.000Z')
    expect(next.orgId).toBe('org-9')
  })

  it('updated merges partial changes (status, period, quantity)', () => {
    const base: OrgBillingState = { ...INITIAL_ORG_BILLING_STATE, ...ACTIVATED_DATA, _version: 1 }
    const next = applyOrgBillingEvent(
      base,
      { _tag: 'org_billing.updated', changes: { status: 'past_due', unitQuantity: 3 } },
      meta(2, '2026-06-28T10:00:00.000Z'),
    )
    expect(next.status).toBe('past_due')
    expect(next.unitQuantity).toBe(3)
    expect(next.tier).toBe('pro')
    expect(next.updatedAt).toBe('2026-06-28T10:00:00.000Z')
    expect(next._version).toBe(2)
  })

  it('canceled drops the tier to free at period end', () => {
    const base: OrgBillingState = { ...INITIAL_ORG_BILLING_STATE, ...ACTIVATED_DATA, _version: 2 }
    const next = applyOrgBillingEvent(
      base,
      { _tag: 'org_billing.canceled', changes: { status: 'canceled', tier: 'free' } },
      meta(3, '2026-07-27T10:00:00.000Z'),
    )
    expect(next.status).toBe('canceled')
    expect(next.tier).toBe('free')
  })

  it('replay: state reconstructs from the event stream alone', () => {
    const stream: { event: OrgBillingEvent; meta: EventMeta }[] = [
      {
        event: { _tag: 'org_billing.activated', data: { ...ACTIVATED_DATA, tier: 'pro' } },
        meta: meta(1, '2026-06-27T10:00:00.000Z'),
      },
      {
        event: { _tag: 'org_billing.updated', changes: { tier: 'advanced', unitQuantity: 4 } },
        meta: meta(2, '2026-06-28T10:00:00.000Z'),
      },
      {
        event: { _tag: 'org_billing.updated', changes: { status: 'past_due' } },
        meta: meta(3, '2026-06-29T10:00:00.000Z'),
      },
    ]
    const final = stream.reduce(
      (state, { event, meta: m }) => applyOrgBillingEvent(state, event, m),
      INITIAL_ORG_BILLING_STATE,
    )
    expect(final.tier).toBe('advanced')
    expect(final.unitQuantity).toBe(4)
    expect(final.status).toBe('past_due')
    expect(final._version).toBe(3)
  })
})
