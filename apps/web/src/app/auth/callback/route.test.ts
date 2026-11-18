import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  upsertUser: vi.fn(),
}))

vi.mock('@/shared/auth/server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } }),
}))
vi.mock('@/shared/auth/upsert-user', () => ({ upsertUser: mocks.upsertUser }))

import { GET } from './route'

function callback(query: string): NextRequest {
  return new NextRequest(`https://oilio.test/auth/callback${query}`)
}

const USER = {
  id: 'auth-1',
  email: 'ana@example.com',
  app_metadata: { oilio_uid: 'legacy-uid' },
  user_metadata: { full_name: 'Ana', email_verified: true },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /auth/callback', () => {
  it('exchanges the code, records the user and lands on the safe `next`', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null })
    const res = await GET(callback('?code=abc&next=%2Fagenda'))
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('abc')
    expect(mocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'legacy-uid', authUserId: 'auth-1', emailVerified: true }),
    )
    expect(res.headers.get('location')).toBe('https://oilio.test/agenda')
  })

  it('never redirects off-site after sign-in', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null })
    const res = await GET(callback('?code=abc&next=%2F%2Fevil.example'))
    expect(new URL(res.headers.get('location') ?? '').origin).toBe('https://oilio.test')
  })

  it('sends a failed exchange back to login without recording anyone', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { code: 'bad_code_verifier', name: 'AuthApiError' },
    })
    const res = await GET(callback('?code=abc'))
    expect(mocks.upsertUser).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe('https://oilio.test/login?error=auth')
  })

  it('sends a request without a code back to login', async () => {
    const res = await GET(callback(''))
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe('https://oilio.test/login?error=auth')
  })
})
