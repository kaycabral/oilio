import { AuthSessionMissingError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  configured: true,
}))

vi.mock('server-only', () => ({}))
vi.mock('@cbrl/supabase/server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve(mocks.configured ? { auth: { getClaims: mocks.getClaims } } : null),
}))

import { getSessionUser } from './session'

beforeEach(() => {
  mocks.getClaims.mockReset()
  mocks.configured = true
})

describe('getSessionUser', () => {
  it('returns null when Supabase is not configured', async () => {
    mocks.configured = false
    expect(await getSessionUser()).toBeNull()
  })

  it('maps verified claims, honoring the legacy uid', async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'auth-1',
          email: 'ana@example.com',
          app_metadata: { oilio_uid: 'legacy-uid' },
          user_metadata: { full_name: 'Ana', email_verified: true },
        },
      },
      error: null,
    })
    expect(await getSessionUser()).toEqual({
      uid: 'legacy-uid',
      authUserId: 'auth-1',
      email: 'ana@example.com',
      displayName: 'Ana',
      picture: null,
      emailVerified: true,
    })
  })

  it('returns null when there is no session', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthSessionMissingError() })
    expect(await getSessionUser()).toBeNull()
  })

  it('returns null when the claims are empty', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    expect(await getSessionUser()).toBeNull()
  })

  it('throws (never reads as signed out) on any other Auth failure', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error('fetch failed') })
    await expect(getSessionUser()).rejects.toThrow('fetch failed')
  })
})
