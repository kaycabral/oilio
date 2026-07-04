// Unit tests for `requireCapability` (brief 0072) — the REAL server-side gating
// wall (the UI `useCapability` is only defense-in-depth). It layers on
// `requireOrgCtx` and decides purely on the TIER via `getOrgTier`.
//
// The load-bearing invariant proven here: gating is TIER-driven and
// STATUS-AGNOSTIC. A paid tier whose subscription is trialing, past_due, or
// scheduled to cancel at period end KEEPS access — `requireCapability` never
// reads `status`, only the tier. Access is removed only when the tier itself
// drops to Free (which the webhook does on subscription.deleted). This is why no
// status check is needed in the guard, and the test guards against a regression
// that would couple gating to status.
//
// Deps mocked: getSessionUser (session), getUserById (user doc → currentOrgId),
// readUnderRls (membership row), getOrgTier (the tier under test). The real
// requireOrgCtx + membership decode run, so the composition is exercised.

import { defaultPermissionsForRole, type Role } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getUserById: vi.fn(),
  readUnderRls: vi.fn(),
  getOrgTier: vi.fn(),
  track: vi.fn(),
}))

vi.mock('@/shared/firebase/admin', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/shared/db/pg/users-store', () => ({
  getUserById: mocks.getUserById,
  getUsersByIds: vi.fn(),
}))
vi.mock('@/shared/db/pg/rls-read', () => ({
  readUnderRls: mocks.readUnderRls,
  readAsSubject: vi.fn(),
}))
vi.mock('@/shared/org/billing-read', () => ({ getOrgTier: mocks.getOrgTier }))
vi.mock('@/shared/lib/track', () => ({ track: mocks.track }))

import {
  requireCapability,
  requireRecurringManagerCtx,
  requireRecurringOwnerCtx,
} from './membership'

const ORG = 'org-1'
const UID = 'user-1'

function membershipRow(role: Role = 'owner'): Record<string, unknown> {
  return {
    org_id: ORG,
    id: `${ORG}_${UID}`,
    user_id: UID,
    last_event_version: 1,
    role,
    status: 'active',
    rls_unit_scope: null,
    invited_by: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    permissions: defaultPermissionsForRole(role),
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function signedIn(): void {
  mocks.getSessionUser.mockResolvedValue({ uid: UID, emailVerified: true })
  mocks.getUserById.mockResolvedValue({ uid: UID, currentOrgId: ORG })
  mocks.readUnderRls.mockResolvedValue([membershipRow()])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireCapability', () => {
  it('allows a Pro org to use a paid capability', async () => {
    signedIn()
    mocks.getOrgTier.mockResolvedValue('pro')

    const res = await requireCapability('plans.recurring')

    expect(res.ok).toBe(true)
  })

  it('denies a Free org with an upgrade-pointing error', async () => {
    signedIn()
    mocks.getOrgTier.mockResolvedValue('free')

    const res = await requireCapability('plans.recurring')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('upgrade')
  })

  it('denies a Pro org a capability only Avançado has (support.priority)', async () => {
    signedIn()
    mocks.getOrgTier.mockResolvedValue('pro')

    const res = await requireCapability('support.priority')

    expect(res.ok).toBe(false)
  })

  it('propagates the auth-context error when not signed in (never reaches the tier)', async () => {
    mocks.getSessionUser.mockResolvedValue(null)

    const res = await requireCapability('plans.recurring')

    expect(res.ok).toBe(false)
    expect(mocks.getOrgTier).not.toHaveBeenCalled()
  })

  // The decisive invariant: gating depends on TIER, not subscription STATUS.
  // requireCapability calls getOrgTier (which returns the tier regardless of
  // trialing/past_due/cancel-pending) and never inspects status — so a paid tier
  // keeps access through every non-canceled lifecycle state. If someone later
  // coupled gating to status, this test breaks.
  it('keeps access for a paid tier irrespective of subscription status (tier-driven, status-agnostic)', async () => {
    signedIn()
    // Whatever the underlying status (trialing / past_due / cancel_at_period_end),
    // getOrgBilling still resolves the tier as advanced until the webhook drops it
    // to free. requireCapability only consumes the tier.
    mocks.getOrgTier.mockResolvedValue('advanced')

    for (const cap of [
      'plans.recurring',
      'commissions',
      'copilot.profit_goal',
      'reports.sales',
      'units.unlimited',
      'support.priority',
    ] as const) {
      const res = await requireCapability(cap)
      expect(res.ok).toBe(true)
    }
  })
})

// The shared wall for recurring-resource actions (brief 0088 AC-01/AC-04):
// RBAC (manager/owner) AND `plans.recurring` tier — both must pass. This is what
// every gated action (updatePlan/…/markChargeFailed) now composes.
describe('requireRecurringManagerCtx', () => {
  it('allows a Pro manager (RBAC ∧ tier both pass)', async () => {
    signedIn()
    mocks.getOrgTier.mockResolvedValue('pro')

    const res = await requireRecurringManagerCtx()

    expect(res.ok).toBe(true)
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('denies a Free manager and emits capability_denied', async () => {
    signedIn()
    mocks.getOrgTier.mockResolvedValue('free')

    const res = await requireRecurringManagerCtx()

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Pro')
    expect(mocks.track).toHaveBeenCalledWith(
      'capability_denied',
      expect.objectContaining({ capability: 'plans.recurring', surface: 'action' }),
    )
  })

  it('denies on RBAC BEFORE reading the tier (a non-manager never reaches the wall)', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: UID, emailVerified: true })
    mocks.getUserById.mockResolvedValue({ uid: UID, currentOrgId: ORG })
    mocks.readUnderRls.mockResolvedValue([membershipRow('receptionist')])

    const res = await requireRecurringManagerCtx()

    expect(res.ok).toBe(false)
    expect(mocks.getOrgTier).not.toHaveBeenCalled()
    expect(mocks.track).not.toHaveBeenCalled()
  })
})

describe('requireRecurringOwnerCtx', () => {
  it('allows a Pro owner', async () => {
    signedIn()
    mocks.getOrgTier.mockResolvedValue('pro')

    const res = await requireRecurringOwnerCtx()

    expect(res.ok).toBe(true)
  })

  it('denies a manager (owner required) before the tier read', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: UID, emailVerified: true })
    mocks.getUserById.mockResolvedValue({ uid: UID, currentOrgId: ORG })
    mocks.readUnderRls.mockResolvedValue([membershipRow('manager')])

    const res = await requireRecurringOwnerCtx()

    expect(res.ok).toBe(false)
    expect(mocks.getOrgTier).not.toHaveBeenCalled()
  })
})
