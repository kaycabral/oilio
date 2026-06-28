// Unit tests for `requireManagerPage` (brief 0029, AC-08) — the PAGE-level
// server wall behind the nav's client-side `requires: 'manageOrg'` gate.
//
// This is the helper that closes the original leak: routes hidden from
// non-managers in the sidebar (/copilot, /team, /billing, /reports, ...) were
// still reachable by typing the URL because their loaders only checked auth, not
// role. requireManagerPage REDIRECTS a non-manager, so the wall can't be skipped
// per-route. These tests pin that contract:
//   - owner / manager → returns the ctx (allowed through)
//   - professional / receptionist → redirect (blocked), default to /agenda
//   - not signed in / no org → redirect to /login / /onboarding (auth chain)
//
// `redirect` throws in Next; it's mocked to throw a recognizable sentinel so the
// test asserts WHERE a blocked visitor lands.

import { defaultPermissionsForRole, type Role } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getUserById: vi.fn(),
  readUnderRls: vi.fn(),
  isFirebaseConfigured: vi.fn(() => true),
}))

vi.mock('@/shared/firebase/admin', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/shared/firebase/config', () => ({ isFirebaseConfigured: mocks.isFirebaseConfigured }))
vi.mock('@/shared/db/pg/users-store', () => ({
  getUserById: mocks.getUserById,
  getUsersByIds: vi.fn(),
}))
vi.mock('@/shared/db/pg/rls-read', () => ({
  readUnderRls: mocks.readUnderRls,
  readAsSubject: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

import { requireManagerPage } from './membership'

const ORG = 'org-1'
const UID = 'user-1'

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
  mocks.isFirebaseConfigured.mockReturnValue(true)
})

describe('requireManagerPage', () => {
  it('lets an owner through, returning the ctx', async () => {
    signedInAs('owner')
    const ctx = await requireManagerPage()
    expect(ctx.membership.role).toBe('owner')
    expect(ctx.session.uid).toBe(UID)
  })

  it('lets a manager through', async () => {
    signedInAs('manager')
    const ctx = await requireManagerPage()
    expect(ctx.membership.role).toBe('manager')
  })

  it('redirects a receptionist to /agenda (the leak this closes)', async () => {
    signedInAs('receptionist')
    await expect(requireManagerPage()).rejects.toThrow('NEXT_REDIRECT:/agenda')
  })

  it('redirects a professional to /agenda', async () => {
    signedInAs('professional')
    await expect(requireManagerPage()).rejects.toThrow('NEXT_REDIRECT:/agenda')
  })

  it('honors a custom not-manager destination', async () => {
    signedInAs('receptionist')
    await expect(requireManagerPage('/dashboard')).rejects.toThrow('NEXT_REDIRECT:/dashboard')
  })

  it('redirects to /login when not signed in (never reaches the role check)', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    await expect(requireManagerPage()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('redirects to /onboarding when there is no active org', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: UID, emailVerified: true })
    mocks.getUserById.mockResolvedValue({ uid: UID, currentOrgId: null })
    await expect(requireManagerPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  it('redirects home when Firebase is not configured', async () => {
    mocks.isFirebaseConfigured.mockReturnValue(false)
    await expect(requireManagerPage()).rejects.toThrow('NEXT_REDIRECT:/')
  })
})
