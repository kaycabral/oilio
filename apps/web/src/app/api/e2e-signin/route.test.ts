import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  upsertUser: vi.fn(),
}))

vi.mock('@cbrl/supabase/server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}))
vi.mock('@/shared/auth/upsert-user', () => ({ upsertUser: mocks.upsertUser }))

import { POST } from './route'

function post(body: unknown): NextRequest {
  return new NextRequest('https://oilio.test/api/e2e-signin', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/e2e-signin', () => {
  it('does not exist unless ENABLE_TEST_AUTH is exactly "true"', async () => {
    for (const value of [undefined, '', '1', 'TRUE']) {
      vi.stubEnv('ENABLE_TEST_AUTH', value)
      const res = await POST(post({ email: 'a@b.c', password: 'x' }))
      expect(res.status).toBe(404)
    }
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    vi.stubEnv('ENABLE_TEST_AUTH', 'true')
    expect((await POST(post({ email: 'a@b.c' }))).status).toBe(400)
  })

  it('signs in on the local stack and records the user', async () => {
    vi.stubEnv('ENABLE_TEST_AUTH', 'true')
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'auth-1', email: 'a@b.c', app_metadata: {}, user_metadata: {} } },
      error: null,
    })
    const res = await POST(post({ email: 'a@b.c', password: 'pw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ uid: 'auth-1', userId: 'auth-1' })
    expect(mocks.upsertUser).toHaveBeenCalledWith(expect.objectContaining({ uid: 'auth-1' }))
  })

  it('answers 401 on bad credentials', async () => {
    vi.stubEnv('ENABLE_TEST_AUTH', 'true')
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })
    expect((await POST(post({ email: 'a@b.c', password: 'bad' }))).status).toBe(401)
  })
})
