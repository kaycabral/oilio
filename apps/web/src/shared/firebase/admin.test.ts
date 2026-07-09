import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn<(name: string) => { value: string } | undefined>(),
  verifySessionCookie: vi.fn(),
}))

vi.mock('next/headers', () => ({
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
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(1)
  })

  it('retries a transient verification failure and recovers (does NOT log out)', async () => {
    mocks.verifySessionCookie
      .mockRejectedValueOnce(authError('auth/internal-error'))
      .mockResolvedValueOnce(VALID_DECODED)

    const user = await getSessionUser()

    expect(user).not.toBeNull()
    expect(user?.uid).toBe('u1')
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(2)
  })

  it('retries a transient error that has no auth code', async () => {
    mocks.verifySessionCookie
      .mockRejectedValueOnce(new Error(' ECONNRESET'))
      .mockResolvedValueOnce(VALID_DECODED)

    expect((await getSessionUser())?.uid).toBe('u1')
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(2)
  })

  it('throws (never returns null) when a transient failure persists', async () => {
    mocks.verifySessionCookie.mockRejectedValue(authError('auth/internal-error'))
    await expect(getSessionUser()).rejects.toThrow()
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(3)
  })
})
