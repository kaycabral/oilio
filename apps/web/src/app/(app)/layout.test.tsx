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
// resolveActiveUnit reads the device-local active-unit cookie when the org has
// units; outside a request scope `cookies()` throws, so stub an empty store.
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

  function mockUnitsSnap(docs: { id: string; data: () => unknown }[]) {
    mocks.getAdminFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            orderBy: () => {
              const ref = {
                withConverter: () => ref,
                get: () => Promise.resolve({ docs }),
              }
              return ref
            },
          }),
        }),
      }),
    })
  }

  it('sends an owner with no units to the guided first-unit flow (brief 0046)', async () => {
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
    mockUnitsSnap([])
    // Signup creates the Negócio without a unit; the owner is guided to create
    // the first unit rather than rendering the operational shell over no data.
    await expect(captureRedirect()).resolves.toBe('/onboarding/first-unit')
  })

  it('does NOT force a non-owner (manager) with no units into first-unit', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u2',
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
      selfBookingPublished: false,
    })
    mockUnitsSnap([])
    // An invited manager joining a not-yet-set-up org must not be bootstrapped
    // into unit creation (it's the owner's job) — the shell renders, no redirect.
    await expect(callLayout()).resolves.toBeTruthy()
  })

  it('renders the app shell once the org has at least one unit (#986)', async () => {
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
    mockUnitsSnap([
      {
        id: 'unit-1',
        data: () => ({ id: 'unit-1', name: 'Matriz', archivedAt: null }),
      },
    ])
    // App is operable from signup once a unit exists — no global wizard gate.
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
