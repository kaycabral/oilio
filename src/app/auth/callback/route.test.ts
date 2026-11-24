import { fakeCookieStore, fakeSupabaseAuth } from '@/shared/auth/fake-supabase-ssr'
import type * as Log from '@cbrl/log'
import { AuthApiError, type User } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upsertUser: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('@cbrl/log', async (importOriginal) => ({
  ...(await importOriginal<typeof Log>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: mocks.error },
}))

vi.mock('@supabase/ssr', () => import('@/shared/auth/fake-supabase-ssr'))
vi.mock('next/headers', async () => {
  const { fakeCookieStore: store } = await import('@/shared/auth/fake-supabase-ssr')
  return { cookies: () => Promise.resolve(store) }
})
vi.mock('@/shared/auth/upsert-user', () => ({ upsertUser: mocks.upsertUser }))

import { GET } from './route'

const ORIGIN = 'https://oilio.test'
const CODE = 'pkce-code-123'
const SESSION_COOKIE = {
  name: 'sb-oilio-auth-token',
  value: 'base64-session',
  options: { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 34_560_000 },
}

function googleUser(overrides: Partial<User> = {}): User {
  return {
    id: 'auth-1',
    aud: 'authenticated',
    email: 'ana@example.com',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'google' },
    user_metadata: {
      full_name: 'Ana Souza',
      avatar_url: 'https://lh3.googleusercontent.com/a/ana',
      email_verified: true,
    },
    ...overrides,
  }
}

function callback(query: Record<string, string>): NextRequest {
  const url = new URL('/auth/callback', ORIGIN)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

function location(res: Response): string | null {
  return res.headers.get('location')
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  fakeSupabaseAuth.reset()
  fakeCookieStore.reset()
  mocks.upsertUser.mockReset().mockResolvedValue(undefined)
  mocks.warn.mockClear()
  mocks.error.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /auth/callback — successful Google sign-in', () => {
  it('exchanges the code with the configured Supabase project', async () => {
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(fakeSupabaseAuth.clients).toEqual([
      { url: 'https://project.supabase.co', key: 'sb_publishable_test' },
    ])
    expect(fakeSupabaseAuth.exchangedCodes).toEqual([CODE])
  })

  it('writes the session cookie to the request cookie store', async () => {
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(fakeCookieStore.get(SESSION_COOKIE.name)).toEqual(SESSION_COOKIE)
  })

  it('records a new account under its Supabase id', async () => {
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(mocks.upsertUser).toHaveBeenCalledExactlyOnceWith({
      uid: 'auth-1',
      authUserId: 'auth-1',
      email: 'ana@example.com',
      displayName: 'Ana Souza',
      picture: 'https://lh3.googleusercontent.com/a/ana',
      emailVerified: true,
    })
  })

  it('records a migrated account under its legacy Firebase uid', async () => {
    fakeSupabaseAuth.signsIn(
      googleUser({ app_metadata: { provider: 'google', oilio_uid: 'firebase-uid-9' } }),
      [SESSION_COOKIE],
    )
    await GET(callback({ code: CODE }))
    expect(mocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'firebase-uid-9', authUserId: 'auth-1' }),
    )
  })

  it('records the user before redirecting into the app', async () => {
    const order: string[] = []
    mocks.upsertUser.mockImplementation(() => {
      order.push('upsert')
      return Promise.resolve()
    })
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    const res = await GET(callback({ code: CODE }))
    order.push('redirect')
    expect(order).toEqual(['upsert', 'redirect'])
    expect(res.status).toBe(307)
  })

  it('lands on the requested same-origin `next`, keeping its query', async () => {
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    const res = await GET(callback({ code: CODE, next: '/agenda?day=2026-11-23' }))
    expect(location(res)).toBe(`${ORIGIN}/agenda?day=2026-11-23`)
  })

  it('lands on the dashboard when no `next` is given', async () => {
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    const res = await GET(callback({ code: CODE }))
    expect(location(res)).toBe(`${ORIGIN}/dashboard`)
  })
})

describe('GET /auth/callback — failing user upsert', () => {
  it('sends the user back to login instead of into the app', async () => {
    mocks.upsertUser.mockRejectedValue(new Error('db down'))
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    const res = await GET(callback({ code: CODE, next: '/agenda' }))
    expect(res.status).toBe(307)
    expect(location(res)).toBe(`${ORIGIN}/login?error=auth`)
  })

  it('signs the fresh session out, clearing its cookie', async () => {
    mocks.upsertUser.mockRejectedValue(new Error('db down'))
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(fakeSupabaseAuth.signOutScopes).toEqual(['local'])
    expect(fakeCookieStore.get(SESSION_COOKIE.name)).toMatchObject({
      value: '',
      options: { maxAge: 0 },
    })
  })

  it('logs the error name and code only, never its message', async () => {
    const failure = Object.assign(new Error('duplicate key: ana@example.com (Ana Souza)'), {
      code: '23505',
    })
    mocks.upsertUser.mockRejectedValue(failure)
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('user upsert failed', {
      scope: 'auth',
      error: 'Error:23505',
    })
    expect(JSON.stringify(mocks.error.mock.calls)).not.toMatch(/ana@example\.com|Ana Souza/)
  })

  it('logs the error name when there is no code', async () => {
    mocks.upsertUser.mockRejectedValue(new TypeError('fetch failed'))
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(mocks.error).toHaveBeenCalledWith('user upsert failed', {
      scope: 'auth',
      error: 'TypeError',
    })
  })

  it('logs a non-Error throw as unknown', async () => {
    mocks.upsertUser.mockRejectedValue('ana@example.com')
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    await GET(callback({ code: CODE }))
    expect(mocks.error).toHaveBeenCalledWith('user upsert failed', {
      scope: 'auth',
      error: 'unknown',
    })
  })
})

describe('GET /auth/callback — open redirect in `next`', () => {
  it.each([
    ['protocol-relative', '//evil.example/phish'],
    ['backslash host', '/\\evil.example'],
    ['tab-smuggled host', '/\t/evil.example'],
    ['absolute https URL', 'https://evil.example/phish'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'dashboard'],
  ])('falls back to the dashboard for a %s', async (_label, next) => {
    fakeSupabaseAuth.signsIn(googleUser(), [SESSION_COOKIE])
    const res = await GET(callback({ code: CODE, next }))
    expect(location(res)).toBe(`${ORIGIN}/dashboard`)
  })
})

describe('GET /auth/callback — failed sign-in', () => {
  it('sends a rejected code back to login without recording anyone', async () => {
    fakeSupabaseAuth.rejectsCode(new AuthApiError('invalid flow state', 400, 'bad_code_verifier'))
    const res = await GET(callback({ code: CODE, next: '/agenda' }))
    expect(location(res)).toBe(`${ORIGIN}/login?error=auth`)
    expect(mocks.upsertUser).not.toHaveBeenCalled()
    expect(fakeCookieStore.getAll()).toEqual([])
  })

  it('logs the failure by error code only', async () => {
    fakeSupabaseAuth.rejectsCode(new AuthApiError('invalid flow state', 400, 'bad_code_verifier'))
    await GET(callback({ code: CODE }))
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith('code exchange failed', {
      scope: 'auth',
      error: 'bad_code_verifier',
    })
  })

  it('logs the error name when Supabase sends no code', async () => {
    fakeSupabaseAuth.rejectsCode(new AuthApiError('upstream', 502, undefined))
    await GET(callback({ code: CODE }))
    expect(mocks.warn).toHaveBeenCalledWith('code exchange failed', {
      scope: 'auth',
      error: 'AuthApiError',
    })
  })

  it('sends a request without a code back to login', async () => {
    const res = await GET(callback({ next: '/agenda' }))
    expect(location(res)).toBe(`${ORIGIN}/login?error=auth`)
    expect(fakeSupabaseAuth.exchangedCodes).toEqual([])
    expect(mocks.upsertUser).not.toHaveBeenCalled()
  })

  it('sends the user back to login when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const res = await GET(callback({ code: CODE }))
    expect(location(res)).toBe(`${ORIGIN}/login?error=auth`)
    expect(fakeSupabaseAuth.clients).toEqual([])
  })
})
