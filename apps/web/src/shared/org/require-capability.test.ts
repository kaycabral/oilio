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

  it('keeps access for a paid tier irrespective of subscription status (tier-driven, status-agnostic)', async () => {
    signedIn()
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
