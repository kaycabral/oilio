import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isFirebaseConfigured: vi.fn(() => true),
  getSessionUser: vi.fn(),
  getActiveTenantContext: vi.fn(),
  listAccessibleTenants: vi.fn(() => Promise.resolve([])),
  getTenant: vi.fn(),
  getAdminFirestore: vi.fn(),
}))

vi.mock('@/shared/firebase/admin', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: mocks.isFirebaseConfigured,
}))

vi.mock('@/shared/tenant/membership', () => ({
  getActiveTenantContext: mocks.getActiveTenantContext,
  listAccessibleTenants: mocks.listAccessibleTenants,
}))

vi.mock('@/shared/tenant/tenant', () => ({
  getTenant: mocks.getTenant,
}))

vi.mock('@/shared/db', () => ({
  getAdminFirestore: mocks.getAdminFirestore,
}))

vi.mock('@/shared/tenant/tenant-context', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  mocks.getActiveTenantContext.mockReset()
  mocks.getTenant.mockReset()
  mocks.getAdminFirestore.mockReset()
})

describe('AppLayout — auth and tenant gating', () => {
  it('redirects to / when Firebase is not configured', async () => {
    mocks.isFirebaseConfigured.mockReturnValue(false)
    await expect(captureRedirect()).resolves.toBe('/')
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
  })

  it('redirects to /login when no session cookie is present', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    await expect(captureRedirect()).resolves.toBe('/login')
  })

  it('redirects to /onboarding when the user has no active tenant context', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveTenantContext.mockResolvedValue(null)
    await expect(captureRedirect()).resolves.toBe('/onboarding')
  })

  it('renders the app for an incomplete tenant (no global onboarding gate, #986)', async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: 'u1',
      email: 'a@b.com',
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    mocks.getActiveTenantContext.mockResolvedValue({
      user: {
        uid: 'u1',
        displayName: 'A',
        email: 'a@b.com',
        avatarUrl: null,
        completionCompleted: true,
      },
      membership: { tenantId: 't1', userId: 'u1', role: 'owner' },
    })
    mocks.getTenant.mockResolvedValue({
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
    // An incomplete tenant no longer bounces to the wizard — the layout
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
    mocks.getActiveTenantContext.mockResolvedValue({
      user: {
        uid: 'u1',
        displayName: 'A',
        email: 'a@b.com',
        avatarUrl: null,
        completionCompleted: false,
      },
      membership: { tenantId: 't1', userId: 'u1', role: 'owner' },
    })
    // getTenant must not even be reached when completion fails — the
    // sequence checks user.completionCompleted first.
    await expect(captureRedirect()).resolves.toBe('/onboarding/profile')
    expect(mocks.getTenant).not.toHaveBeenCalled()
  })
})
