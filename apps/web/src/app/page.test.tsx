import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isFirebaseConfigured: vi.fn(() => true),
  getSessionUser: vi.fn(),
  resolvePostAuthDestination: vi.fn(),
}))

vi.mock('@/shared/firebase/admin', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/shared/firebase/config', () => ({ isFirebaseConfigured: mocks.isFirebaseConfigured }))
vi.mock('@/shared/identity/post-auth-destination', () => ({
  resolvePostAuthDestination: mocks.resolvePostAuthDestination,
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`__REDIRECT__:${path}`)
  },
}))

vi.mock('@/components/marketing/MarketingShell', () => ({
  MarketingShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/Hero', () => ({ Hero: () => null }))
vi.mock('@/components/landing/Features', () => ({ Features: () => null }))
vi.mock('@/components/landing/Verticals', () => ({ Verticals: () => null }))
vi.mock('@/components/landing/MultiBusiness', () => ({ MultiBusiness: () => null }))
vi.mock('@/components/landing/HowItWorks', () => ({ HowItWorks: () => null }))
vi.mock('@/components/landing/ClosingCta', () => ({ ClosingCta: () => null }))

import HomePage from './page'

async function captureRedirect(): Promise<string | null> {
  try {
    await HomePage()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('__REDIRECT__:')) return msg.slice('__REDIRECT__:'.length)
    throw err
  }
  return null
}

beforeEach(() => {
  mocks.isFirebaseConfigured.mockReset().mockReturnValue(true)
  mocks.getSessionUser.mockReset()
  mocks.resolvePostAuthDestination.mockReset()
})

describe('HomePage — landing gate', () => {
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

  it('renders the marketing page for an anonymous visitor', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    expect(await captureRedirect()).toBeNull()
    expect(mocks.resolvePostAuthDestination).not.toHaveBeenCalled()
  })
})
