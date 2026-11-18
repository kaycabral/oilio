import type { ActiveUnitContext } from '@/shared/org/active-unit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthConfigured: vi.fn(() => true),
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

vi.mock('@/shared/auth/config', () => ({
  isAuthConfigured: mocks.isAuthConfigured,
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

const REDIRECT_SENTINEL = Symbol('NEXT_REDIRECT')
type RedirectError = Error & { [REDIRECT_SENTINEL]: true }
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const err: RedirectError = Object.assign(new Error(`__REDIRECT__:${path}`), {
      [REDIRECT_SENTINEL]: true as const,
    })
    throw err
  },
}))

import AppLayout from './layout'

function callLayout() {
  return AppLayout({ children: <div aria-label="children" /> })
}

async function captureRedirect(): Promise<string> {
  try {
    await callLayout()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('__REDIRECT__:')) return msg.slice('__REDIRECT__:'.length)
    throw err
  }
  throw new Error('Expected redirect to be thrown, but layout resolved')
}

beforeEach(() => {
  mocks.isAuthConfigured.mockReset().mockReturnValue(true)
  mocks.getSessionUser.mockReset()
  mocks.getActiveOrgContext.mockReset()
  mocks.getOrg.mockReset()
  mocks.needsUnitSelection.mockReset().mockResolvedValue(false)
  mocks.resolveActiveUnit.mockReset().mockResolvedValue({ units: [], activeUnitId: null })
  mocks.listLinkedOrgIds.mockReset().mockResolvedValue([])
})

describe('AppLayout — auth and org gating', () => {
  it('redirects to / when auth is not configured', async () => {
    mocks.isAuthConfigured.mockReturnValue(false)
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
    await expect(callLayout()).resolves.toBeTruthy()
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
    await expect(callLayout()).resolves.toBeTruthy()
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
    await expect(callLayout()).resolves.toBeTruthy()
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
})
