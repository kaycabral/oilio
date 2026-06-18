import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isFirebaseConfigured: vi.fn(() => true),
  getSessionUser: vi.fn(),
  getActiveOrgContext: vi.fn(),
  listAccessibleOrgs: vi.fn(() => Promise.resolve([])),
  getOrg: vi.fn(),
  getAdminFirestore: vi.fn(),
}))

vi.mock('@/shared/firebase/admin', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: mocks.isFirebaseConfigured,
}))

vi.mock('@/shared/org/membership', () => ({
  getActiveOrgContext: mocks.getActiveOrgContext,
  listAccessibleOrgs: mocks.listAccessibleOrgs,
}))

vi.mock('@/shared/org/org', () => ({
  getOrg: mocks.getOrg,
}))

vi.mock('@/shared/db', () => ({
  getAdminFirestore: mocks.getAdminFirestore,
}))

vi.mock('@/shared/org/org-context', () => ({
  OrgProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <main aria-label="app-shell">{children}</main>
  ),
}))

// next/navigation.redirect throws NEXT_REDIRECT in real Next; we throw a
// shaped sentinel so each redirect destination is assertable by message.
const REDIRECT_SENTINEL = Symbol('NEXT_REDIRECT')
type RedirectError = Error & { [REDIRECT_SENTINEL]: true }
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
  mocks.isFirebaseConfigured.mockReset().mockReturnValue(true)
  mocks.getSessionUser.mockReset()
  mocks.getActiveOrgContext.mockReset()
  mocks.getOrg.mockReset()
  mocks.getAdminFirestore.mockReset()
})

describe('AppLayout — auth and org gating', () => {
  it('redirects to / when Firebase is not configured', async () => {
    mocks.isFirebaseConfigured.mockReturnValue(false)
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
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveOrgContext.mockResolvedValue(null)
    await expect(captureRedirect()).resolves.toBe('/onboarding')
  })

  it('renders the app for an incomplete org (no global onboarding gate, #986)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
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
      selfBookingPublished: false,
    })
    mocks.getAdminFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            orderBy: () => {
              const ref = {
                withConverter: () => ref,
                get: () => Promise.resolve({ docs: [] }),
              }
              return ref
            },
          }),
        }),
      }),
    })
    // An incomplete org no longer bounces to the wizard — the layout
    // resolves to the app shell so the app is operable from signup.
    await expect(callLayout()).resolves.toBeTruthy()
  })

  it('redirects to /onboarding/profile when the user has not completed the post-OAuth step (#838)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
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
    // getOrg must not even be reached when completion fails — the
    // sequence checks user.completionCompleted first.
    await expect(captureRedirect()).resolves.toBe('/onboarding/profile')
    expect(mocks.getOrg).not.toHaveBeenCalled()
  })
})
