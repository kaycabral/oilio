import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

import { deleteAuthUser } from './admin'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockReturnValue({ auth: { admin: { deleteUser: mocks.deleteUser } } })
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_x')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('deleteAuthUser', () => {
  it('deletes the Auth user with the server-only secret key', async () => {
    mocks.deleteUser.mockResolvedValue({ error: null })
    await deleteAuthUser('auth-1')
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://ref.supabase.co',
      'sb_secret_x',
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false } }),
    )
    expect(mocks.deleteUser).toHaveBeenCalledWith('auth-1')
  })

  it('treats an already-deleted user as done', async () => {
    mocks.deleteUser.mockResolvedValue({ error: { status: 404, message: 'User not found' } })
    await expect(deleteAuthUser('auth-1')).resolves.toBeUndefined()
  })

  it('surfaces any other failure', async () => {
    const error = { status: 500, message: 'boom' }
    mocks.deleteUser.mockResolvedValue({ error })
    await expect(deleteAuthUser('auth-1')).rejects.toBe(error)
  })

  it('refuses to run without the secret key', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    await expect(deleteAuthUser('auth-1')).rejects.toThrow()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })
})
