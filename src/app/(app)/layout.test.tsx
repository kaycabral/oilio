import type { ActiveUnitContext } from '@/shared/org/active-unit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSessionUser: vi.fn(),
  getActiveOrgContext: vi.fn(),
  listAccessibleOrgs: vi.fn(() => Promise.resolve([])),
  getOrg: vi.fn(),
  needsUnitSelection: vi.fn((): Promise<boolean> => Promise.resolve(false)),
  resolveActiveUnit: vi.fn((): Promise<ActiveUnitContext> =>
    Promise.resolve({ units: [], activeUnitId: null }),
  ),
  listLinkedOrgIds: vi.fn((): Promise<string[]> => Promise.resolve([])),
}))

vi.mock('@/shared/auth/session', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@cbrl/supabase', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}))

vi.mock('@/shared/org/membership', () => ({
  getActiveOrgContext: mocks.getActiveOrgContext,
  listAccessibleOrgs: mocks.listAccessibleOrgs,
}))

vi.mock('@/shared/org/org', () => ({
  getOrg: mocks.getOrg,
}))

vi.mock('@/shared/identity/org-links', () => ({
  listLinkedOrgIds: mocks.listLinkedOrgIds,
}))

vi.mock('@/shared/org/billing-read', () => ({
  getOrgTier: vi.fn(() => Promise.resolve('free')),
}))

vi.mock('@/shared/org/active-unit', () => ({
  needsUnitSelection: mocks.needsUnitSelection,
  resolveActiveUnit: mocks.resolveActiveUnit,
}))

vi.mock('@/shared/org/org-context', () => ({
  OrgProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <main aria-label="app-shell">{children}</main>
  ),
}))

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))

vi.mock('@/components/gate-redirect', () => ({
  GateRedirect: ({ to }: { to: string }) => <a href={to}>redirect</a>,
}))

import { GateRedirect } from '@/components/gate-redirect'
import { isValidElement } from 'react'
import AppLayout from './layout'

function callLayout() {
  return AppLayout({ children: <div aria-label="children" /> })
}

async function captureRedirect(): Promise<string> {
  const out = await callLayout()
  if (isValidElement<{ to: string }>(out) && out.type === GateRedirect) return out.props.to
  throw new Error('Expected a GateRedirect, but layout rendered the app')
}

async function expectAppShell(): Promise<void> {
  const out = await callLayout()
  expect(isValidElement(out) && out.type !== GateRedirect).toBe(true)
}

beforeEach(() => {
  mocks.isSupabaseConfigured.mockReset().mockReturnValue(true)
  mocks.getSessionUser.mockReset()
  mocks.getActiveOrgContext.mockReset()
  mocks.getOrg.mockReset()
  mocks.needsUnitSelection.mockReset().mockResolvedValue(false)
  mocks.resolveActiveUnit.mockReset().mockResolvedValue({ units: [], activeUnitId: null })
  mocks.listLinkedOrgIds.mockReset().mockResolvedValue([])
})

describe('AppLayout — auth and org gating', () => {
  it('redirects to / when auth is not configured', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false)
    await expect(captureRedirect()).resolves.toBe('/')
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
  })

  it('redirects to /login when no session cookie is present', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    await expect(captureRedirect()).resolves.toBe('/login')
  })

  it('redirects to /onboarding when the user has no active org context', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      authUserId: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue(null)
    await expect(captureRedirect()).resolves.toBe('/onboarding')
  })

  it('sends a customer (no membership, but linked orgs) to their own area, not onboarding (#1317)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      authUserId: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue(null)
    mocks.listLinkedOrgIds.mockResolvedValue(['org-9'])
    await expect(captureRedirect()).resolves.toBe('/me/appointments')
  })

  it('renders the app shell for an owner with no units (no first-unit gate)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      authUserId: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue({
      user: {
        uid: 'u1',
        displayName: 'A',
        email: 'a@b.com',
        avatarUrl: null,
        completionCompleted: true,
      },
      membership: { orgId: 't1', userId: 'u1', role: 'owner' },
    })
    mocks.getOrg.mockResolvedValue({
      id: 't1',
      name: 'Test',
    })
    await expectAppShell()
  })

  it('renders the app shell for a non-owner (manager) with no units', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u2',
      authUserId: 'u2',
      email: 'm@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue({
      user: {
        uid: 'u2',
        displayName: 'M',
        email: 'm@b.com',
        avatarUrl: null,
        completionCompleted: true,
      },
      membership: { orgId: 't1', userId: 'u2', role: 'manager' },
    })
    mocks.getOrg.mockResolvedValue({
      id: 't1',
      name: 'Test',
    })
    await expectAppShell()
  })

  it('renders the app shell once the org has at least one unit (#986)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      authUserId: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue({
      user: {
        uid: 'u1',
        displayName: 'A',
        email: 'a@b.com',
        avatarUrl: null,
        completionCompleted: true,
      },
      membership: { orgId: 't1', userId: 'u1', role: 'owner' },
    })
    mocks.getOrg.mockResolvedValue({
      id: 't1',
      name: 'Test',
    })
    mocks.resolveActiveUnit.mockResolvedValue({
      units: [
        {
          id: 'unit-1',
          orgId: 't1',
          name: 'Matriz',
          slug: 'matriz',
          timezone: 'America/Sao_Paulo',
          archivedAt: null,
          mobile: '',
          email: null,
          agenda: { mode: 'always_open' },
          fiscal: { kind: 'informal' },
          address: {
            postalCode: '00000-000',
            state: 'SP',
            city: 'São Paulo',
            neighborhood: 'Centro',
            street: 'Rua A',
            number: null,
            complement: null,
          },
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      activeUnitId: 'unit-1',
    })
    await expectAppShell()
  })

  it('redirects to /onboarding/profile when the user has not completed the post-OAuth step (#838)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      authUserId: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue({
      user: {
        uid: 'u1',
        displayName: 'A',
        email: 'a@b.com',
        avatarUrl: null,
        completionCompleted: false,
      },
      membership: { orgId: 't1', userId: 'u1', role: 'owner' },
    })
    await expect(captureRedirect()).resolves.toBe('/onboarding/profile')
    expect(mocks.getOrg).not.toHaveBeenCalled()
  })

  it('sends an owner with several units and no valid choice to /select-unit', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      authUserId: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue({
      user: {
        uid: 'u1',
        displayName: 'A',
        email: 'a@b.com',
        avatarUrl: null,
        completionCompleted: true,
      },
      membership: { orgId: 't1', userId: 'u1', role: 'owner' },
    })
    mocks.getOrg.mockResolvedValue({ id: 't1', name: 'Test' })
    mocks.needsUnitSelection.mockResolvedValue(true)
    await expect(captureRedirect()).resolves.toBe('/select-unit')
    expect(mocks.resolveActiveUnit).not.toHaveBeenCalled()
  })
})
