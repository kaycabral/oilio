import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from './session-user'

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  putUser: vi.fn(),
  patchUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/db/pg/users-store', () => ({
  getUserById: mocks.getUserById,
  putUser: mocks.putUser,
  patchUser: mocks.patchUser,
}))

import { upsertUser } from './upsert-user'

const SESSION: SessionUser = {
  uid: 'u1',
  authUserId: 'auth-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  picture: 'https://example.com/a.png',
  emailVerified: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('upsertUser', () => {
  it('creates the users row on first sign-in', async () => {
    mocks.getUserById.mockResolvedValue(null)
    await upsertUser(SESSION)
    expect(mocks.putUser).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u1',
        email: 'ana@example.com',
        displayName: 'Ana',
        avatarUrl: 'https://example.com/a.png',
        emailVerified: true,
        completionCompleted: false,
        anonymizedAt: null,
      }),
    )
    expect(mocks.patchUser).not.toHaveBeenCalled()
  })

  it('refreshes the provider-owned fields on a later sign-in', async () => {
    mocks.getUserById.mockResolvedValue({ uid: 'u1', anonymizedAt: null })
    await upsertUser(SESSION)
    expect(mocks.patchUser).toHaveBeenCalledWith(
      'u1',
      {
        email_verified: true,
        email: 'ana@example.com',
        display_name: 'Ana',
        avatar_url: 'https://example.com/a.png',
      },
      expect.any(String),
    )
  })

  it('never re-hydrates an anonymized account with PII (LGPD)', async () => {
    mocks.getUserById.mockResolvedValue({ uid: 'u1', anonymizedAt: '2026-08-01T00:00:00.000Z' })
    await upsertUser(SESSION)
    expect(mocks.patchUser).not.toHaveBeenCalled()
    expect(mocks.putUser).not.toHaveBeenCalled()
  })
})
