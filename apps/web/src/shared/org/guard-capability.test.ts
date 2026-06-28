// Unit tests for the app-level authorization helpers (brief 0075):
// `guardCapability` (the REAL server-side wall for a membership capability),
// `hasMembershipCapability` (the matrix predicate), `operatesFrontDesk` (balcão
// vs self-scoped professional) and `canActOnOwnedResource` (own-resource gate).
//
// Load-bearing invariant: authorization is gated by the membership's CAPABILITY
// matrix, never by `role` directly — so the four roles stay presets the business
// can later edit. The own-resource gate encodes the operational model: recepção/
// owner/manager run the balcão for everyone; a professional acts only on its own.
//
// Deps mocked: getSessionUser (session), getUserById (user doc → currentOrgId),
// readUnderRls (membership row). The real requireOrgCtx + membership decode run.

import { defaultPermissionsForRole, type Membership, type Role } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getUserById: vi.fn(),
  readUnderRls: vi.fn(),
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
vi.mock('@/shared/org/billing-read', () => ({ getOrgTier: vi.fn() }))

import {
  canActOnOwnedResource,
  guardCapability,
  hasMembershipCapability,
  operatesFrontDesk,
} from './membership'

const ORG = 'org-1'
const UID = 'user-1'

function membership(role: Role, userId = UID): Membership {
  return {
    orgId: ORG,
    id: `${ORG}_${userId}`,
    userId,
    role,
    status: 'active',
    rlsUnitScope: null,
    invitedBy: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    permissions: defaultPermissionsForRole(role),
  }
}

function membershipRow(role: Role): Record<string, unknown> {
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

function signedInAs(role: Role): void {
  mocks.getSessionUser.mockResolvedValue({ uid: UID, emailVerified: true })
  mocks.getUserById.mockResolvedValue({ uid: UID, currentOrgId: ORG })
  mocks.readUnderRls.mockResolvedValue([membershipRow(role)])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hasMembershipCapability', () => {
  it('reads the capability straight off the matrix', () => {
    expect(hasMembershipCapability(membership('owner'), 'canManageCustomers')).toBe(true)
    expect(hasMembershipCapability(membership('professional'), 'canManageCustomers')).toBe(false)
    expect(hasMembershipCapability(membership('professional'), 'canCreateAppointment')).toBe(true)
  })
})

describe('operatesFrontDesk', () => {
  it('is true for owner/manager/receptionist (the balcão)', () => {
    expect(operatesFrontDesk(membership('owner'))).toBe(true)
    expect(operatesFrontDesk(membership('manager'))).toBe(true)
    expect(operatesFrontDesk(membership('receptionist'))).toBe(true)
  })

  it('is false for a self-scoped professional', () => {
    expect(operatesFrontDesk(membership('professional'))).toBe(false)
  })
})

describe('canActOnOwnedResource', () => {
  it('lets the balcão act on anyone’s resource', () => {
    expect(canActOnOwnedResource(membership('receptionist'), 'someone-else')).toBe(true)
    expect(canActOnOwnedResource(membership('manager'), 'someone-else')).toBe(true)
  })

  it('lets a professional act only on their own resource', () => {
    const pro = membership('professional', 'pro-1')
    expect(canActOnOwnedResource(pro, 'pro-1')).toBe(true)
    expect(canActOnOwnedResource(pro, 'pro-2')).toBe(false)
  })
})

describe('guardCapability', () => {
  it('allows when the membership carries the capability', async () => {
    signedInAs('receptionist')

    const res = await guardCapability('canManageCustomers')

    expect(res.ok).toBe(true)
  })

  it('denies when the membership lacks the capability', async () => {
    signedInAs('professional')

    const res = await guardCapability('canManageCustomers')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('canManageCustomers')
  })

  it('allows a professional the capabilities its preset carries (own agenda)', async () => {
    signedInAs('professional')

    expect((await guardCapability('canCreateAppointment')).ok).toBe(true)
    expect((await guardCapability('canCancelAppointment')).ok).toBe(true)
  })

  it('propagates the auth-context error when not signed in', async () => {
    mocks.getSessionUser.mockResolvedValue(null)

    const res = await guardCapability('canManageCustomers')

    expect(res.ok).toBe(false)
    expect(mocks.readUnderRls).not.toHaveBeenCalled()
  })
})
