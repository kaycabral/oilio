import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveOrgContext: vi.fn(),
  listLinkedOrgIds: vi.fn((): Promise<string[]> => Promise.resolve([])),
}))

vi.mock('@/shared/org/membership', () => ({
  getActiveOrgContext: mocks.getActiveOrgContext,
}))

vi.mock('@/shared/identity/org-links', () => ({
  listLinkedOrgIds: mocks.listLinkedOrgIds,
}))

import { resolvePostAuthDestination } from './post-auth-destination'

beforeEach(() => {
  mocks.getActiveOrgContext.mockReset().mockResolvedValue(null)
  mocks.listLinkedOrgIds.mockReset().mockResolvedValue([])
})

describe('resolvePostAuthDestination', () => {
  it('sends a member (active org context) to /dashboard', async () => {
    mocks.getActiveOrgContext.mockResolvedValue({ user: {}, membership: {} })
    expect(await resolvePostAuthDestination('uid')).toBe('/dashboard')
  })

  it('sends a client (org link, no membership) to /me/appointments', async () => {
    mocks.getActiveOrgContext.mockResolvedValue(null)
    mocks.listLinkedOrgIds.mockResolvedValue(['org-1'])
    expect(await resolvePostAuthDestination('uid')).toBe('/me/appointments')
  })

  it('sends an unlinked user to /onboarding', async () => {
    mocks.getActiveOrgContext.mockResolvedValue(null)
    mocks.listLinkedOrgIds.mockResolvedValue([])
    expect(await resolvePostAuthDestination('uid')).toBe('/onboarding')
  })

  it('does not query org links when a membership already exists', async () => {
    mocks.getActiveOrgContext.mockResolvedValue({ user: {}, membership: {} })
    await resolvePostAuthDestination('uid')
    expect(mocks.listLinkedOrgIds).not.toHaveBeenCalled()
  })
})
