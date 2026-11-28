import type { PublicOrgVisibility } from '@/features/self-book/core/public-page-gate'
import { fakeSupabaseAuth } from '@/shared/auth/fake-supabase-ssr'
import type * as Log from '@cbrl/log'
import { AuthRetryableFetchError, type JwtPayload } from '@supabase/supabase-js'
import { tryToParsePath } from 'next/dist/lib/try-to-parse-path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  lookup: vi.fn((): Promise<PublicOrgVisibility> => Promise.resolve(null)),
}))

vi.mock('@supabase/ssr', () => import('@/shared/auth/fake-supabase-ssr'))
vi.mock('@/features/self-book/adapters/public-page-visibility', () => ({
  getPublicOrgVisibility: mocks.lookup,
}))
vi.mock('@cbrl/log', async (importOriginal) => ({
  ...(await importOriginal<typeof Log>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}))

import { config, proxy } from './proxy'

const ORIGIN = 'https://oilio.test'
const STALE = { name: 'sb-oilio-auth-token', value: 'stale-session' }
const REFRESHED = {
  name: 'sb-oilio-auth-token',
  value: 'refreshed-session',
  options: { path: '/', sameSite: 'lax' as const, maxAge: 34_560_000 },
}
const CLAIMS: JwtPayload = {
  sub: 'auth-1',
  aud: 'authenticated',
  exp: 0,
  iat: 0,
  iss: 'https://project.supabase.co/auth/v1',
  role: 'authenticated',
  aal: 'aal1',
  session_id: 'session-1',
}

function pageRequest(path = '/agenda'): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), {
    headers: { cookie: `${STALE.name}=${STALE.value}` },
  })
}

function forwardedCookies(res: Response): string | null {
  return res.headers.get('x-middleware-request-cookie')
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  fakeSupabaseAuth.reset()
  mocks.warn.mockClear()
  mocks.lookup.mockReset().mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('proxy — session refresh', () => {
  it('reads the session from the incoming cookies', async () => {
    fakeSupabaseAuth.keepsSession(CLAIMS)
    await proxy(pageRequest())
    expect(fakeSupabaseAuth.requestCookiesSeen).toEqual([[STALE]])
  })

  it('lets the request through untouched when the session is still valid', async () => {
    fakeSupabaseAuth.keepsSession(CLAIMS)
    const res = await proxy(pageRequest())
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('sends the refreshed session cookie back to the browser', async () => {
    fakeSupabaseAuth.refreshesSession(CLAIMS, [REFRESHED], {})
    const res = await proxy(pageRequest())
    expect(res.cookies.get(REFRESHED.name)).toMatchObject({
      value: REFRESHED.value,
      path: '/',
      sameSite: 'lax',
      maxAge: REFRESHED.options.maxAge,
    })
  })

  it('forwards the refreshed cookie to the page render, not the stale one', async () => {
    fakeSupabaseAuth.refreshesSession(CLAIMS, [REFRESHED], {})
    const res = await proxy(pageRequest())
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(forwardedCookies(res)).toBe(`${REFRESHED.name}=${REFRESHED.value}`)
  })

  it('applies the no-store headers Supabase asks for on a refresh', async () => {
    fakeSupabaseAuth.refreshesSession(CLAIMS, [REFRESHED], {
      'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0',
    })
    const res = await proxy(pageRequest())
    expect(res.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, must-revalidate, max-age=0',
    )
  })
})

describe('proxy — Supabase outage', () => {
  it('still lets the request through', async () => {
    fakeSupabaseAuth.isUnreachable(new AuthRetryableFetchError('fetch failed', 0))
    const res = await proxy(pageRequest())
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('logs the failure by error name only', async () => {
    fakeSupabaseAuth.isUnreachable(new AuthRetryableFetchError('fetch failed', 0))
    await proxy(pageRequest())
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith('session refresh failed', {
      scope: 'auth',
      error: 'AuthRetryableFetchError',
    })
  })

  it('logs a non-Error rejection as unknown', async () => {
    fakeSupabaseAuth.isUnreachable('socket hang up')
    await proxy(pageRequest())
    expect(mocks.warn).toHaveBeenCalledWith('session refresh failed', {
      scope: 'auth',
      error: 'unknown',
    })
  })

  it('skips the refresh when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    const res = await proxy(pageRequest())
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(fakeSupabaseAuth.clients).toEqual([])
  })
})

describe('proxy — public page 404', () => {
  it('answers 404 for an unknown org before the page streams', async () => {
    fakeSupabaseAuth.keepsSession(CLAIMS)
    const res = await proxy(pageRequest('/no-such-org'))
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith('no-such-org')
    expect(res.status).toBe(404)
    expect(res.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/_not-found`)
  })

  it('keeps the refreshed session cookie on the 404', async () => {
    fakeSupabaseAuth.refreshesSession(CLAIMS, [REFRESHED], {})
    const res = await proxy(pageRequest('/no-such-org/unit'))
    expect(res.status).toBe(404)
    expect(res.cookies.get(REFRESHED.name)?.value).toBe(REFRESHED.value)
  })

  it('lets a live public page through', async () => {
    fakeSupabaseAuth.keepsSession(CLAIMS)
    mocks.lookup.mockResolvedValue({ units: [{ slug: 'centro', live: true }] })
    const res = await proxy(pageRequest('/barbearia/centro'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('does not look up app routes', async () => {
    fakeSupabaseAuth.keepsSession(CLAIMS)
    await proxy(pageRequest('/agenda'))
    await proxy(pageRequest('/copilot'))
    expect(mocks.lookup).not.toHaveBeenCalled()
  })
})

describe('proxy — matcher', () => {
  const matchers = config.matcher.map((source) => {
    const { regexStr } = tryToParsePath(source)
    if (regexStr === undefined) throw new Error(`proxy matcher does not compile: ${source}`)
    return new RegExp(regexStr)
  })
  const runsOn = (pathname: string) => matchers.some((matcher) => matcher.test(pathname))

  it.each([
    '/',
    '/dashboard',
    '/agenda',
    '/auth/callback',
    '/login',
    '/api/e2e-signin',
    '/api/health',
  ])('refreshes the session on %s', (pathname) => {
    expect(runsOn(pathname)).toBe(true)
  })

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/monitoring-tunnel',
    '/api/webhooks/stripe',
    '/api/csp-report',
    '/favicon.ico',
    '/manifest.webmanifest',
    '/logo.svg',
    '/og/cover.png',
    '/photos/team.webp',
  ])('skips %s', (pathname) => {
    expect(runsOn(pathname)).toBe(false)
  })
})
