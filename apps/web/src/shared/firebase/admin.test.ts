// Regression tests for #1375 — opening Settings logged the user out because
// `getSessionUser` swallowed ANY verification error into `null`, so a one-off
// network blip on the revocation check (`verifySessionCookie(cookie, true)`) was
// read as "no session" → redirect to /login. The fix: retry transient failures
// internally and only return null for a genuinely invalid cookie; never turn a
// transient failure into a silent logout.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn<(name: string) => { value: string } | undefined>(),
  verifySessionCookie: vi.fn(),
}))

vi.mock('next/headers', () => ({
  // `cookies()` is async in Next 15+, so resolve a store — but there's nothing to
  // await inside the mock, hence `Promise.resolve` instead of an `async` body.
  cookies: () => Promise.resolve({ get: mocks.cookieGet }),
}))
vi.mock('@/shared/db', () => ({
  getAdminAuth: () => ({ verifySessionCookie: mocks.verifySessionCookie }),
}))
vi.mock('./session', () => ({ SESSION_COOKIE_NAME: '__session' }))

import { getSessionUser } from './admin'

const VALID_DECODED = {
  uid: 'u1',
  email: 'u1@test',
  picture: null,
  email_verified: true,
  name: 'User One',
}

// Mirrors a firebase-admin auth error: an Error carrying a string `code`. Built
// via `Object.assign` (not a cast) so the `{ code }` shape is a real property,
// not an assertion the linter flags as narrowing.
function authError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookieGet.mockReturnValue({ value: 'cookie-value' })
})

describe('getSessionUser', () => {
  it('returns null when the cookie is absent', async () => {
    mocks.cookieGet.mockReturnValue(undefined)
    expect(await getSessionUser()).toBeNull()
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled()
  })

  it('returns the session user on a valid cookie', async () => {
    mocks.verifySessionCookie.mockResolvedValue(VALID_DECODED)
    expect(await getSessionUser()).toEqual({
      uid: 'u1',
      email: 'u1@test',
      displayName: 'User One',
      picture: null,
      emailVerified: true,
    })
  })

  it.each([
    'auth/session-cookie-expired',
    'auth/session-cookie-revoked',
    'auth/argument-error',
    'auth/user-disabled',
  ])('returns null for a genuinely invalid cookie (%s)', async (code) => {
    mocks.verifySessionCookie.mockRejectedValue(authError(code))
    expect(await getSessionUser()).toBeNull()
    // invalid cookie never becomes valid — no wasted retries
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(1)
  })

  // #1375 core: a transient failure must NOT log the user out. It is retried and,
  // on recovery, yields the valid session — not null.
  it('retries a transient verification failure and recovers (does NOT log out)', async () => {
    mocks.verifySessionCookie
      .mockRejectedValueOnce(authError('auth/internal-error'))
      .mockResolvedValueOnce(VALID_DECODED)

    const user = await getSessionUser()

    expect(user).not.toBeNull()
    expect(user?.uid).toBe('u1')
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(2)
  })

  // A transient error with no `code` (e.g. a raw network throw) is also retried.
  it('retries a transient error that has no auth code', async () => {
    mocks.verifySessionCookie
      .mockRejectedValueOnce(new Error(' ECONNRESET'))
      .mockResolvedValueOnce(VALID_DECODED)

    expect((await getSessionUser())?.uid).toBe('u1')
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(2)
  })

  // If the transient failure persists past the retry budget, throw — surfacing an
  // error boundary — rather than silently returning null (which would resurrect
  // the #1375 spurious logout).
  it('throws (never returns null) when a transient failure persists', async () => {
    mocks.verifySessionCookie.mockRejectedValue(authError('auth/internal-error'))
    await expect(getSessionUser()).rejects.toThrow()
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(3)
  })
})
