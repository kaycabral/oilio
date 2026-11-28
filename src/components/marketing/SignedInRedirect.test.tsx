import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSessionUser: vi.fn(),
  resolvePostAuthDestination: vi.fn(),
}))

vi.mock('@/shared/auth/session', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@cbrl/supabase', () => ({ isSupabaseConfigured: mocks.isSupabaseConfigured }))
vi.mock('@/shared/identity/post-auth-destination', () => ({
  resolvePostAuthDestination: mocks.resolvePostAuthDestination,
}))

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`__REDIRECT__:${path}`)
  },
}))

import { SignedInRedirect } from './SignedInRedirect'

async function captureRedirect(): Promise<string | null> {
  try {
    await SignedInRedirect()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('__REDIRECT__:')) return msg.slice('__REDIRECT__:'.length)
    throw err
  }
  return null
}

beforeEach(() => {
  mocks.isSupabaseConfigured.mockReset().mockReturnValue(true)
  mocks.getSessionUser.mockReset()
  mocks.resolvePostAuthDestination.mockReset()
})

describe('SignedInRedirect — marketing gate', () => {
  it('routes a logged-in client to their resolved destination, not always /dashboard', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: 'client-1' })
    mocks.resolvePostAuthDestination.mockResolvedValue('/me/appointments')
    expect(await captureRedirect()).toBe('/me/appointments')
  })

  it('routes a logged-in member to /dashboard', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: 'owner-1' })
    mocks.resolvePostAuthDestination.mockResolvedValue('/dashboard')
    expect(await captureRedirect()).toBe('/dashboard')
  })

  it('skips the session read when Supabase is not configured', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false)
    expect(await captureRedirect()).toBeNull()
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
  })

  it('renders nothing for an anonymous visitor', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    expect(await captureRedirect()).toBeNull()
    expect(mocks.resolvePostAuthDestination).not.toHaveBeenCalled()
  })
})
