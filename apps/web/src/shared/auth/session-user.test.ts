import { describe, expect, it } from 'vitest'
import { LEGACY_UID_CLAIM, toSessionUser } from './session-user'

describe('toSessionUser', () => {
  it('uses the Supabase user id as the app uid for an account born on Supabase', () => {
    const user = toSessionUser({
      id: 'b3f1c2d4-0000-4000-8000-000000000001',
      email: 'ana@example.com',
      appMetadata: { provider: 'google' },
      userMetadata: {
        full_name: 'Ana Souza',
        avatar_url: 'https://lh3.googleusercontent.com/a',
        email_verified: true,
      },
    })
    expect(user).toEqual({
      uid: 'b3f1c2d4-0000-4000-8000-000000000001',
      authUserId: 'b3f1c2d4-0000-4000-8000-000000000001',
      email: 'ana@example.com',
      displayName: 'Ana Souza',
      picture: 'https://lh3.googleusercontent.com/a',
      emailVerified: true,
    })
  })

  it('keeps the legacy uid pinned in app_metadata for a migrated account', () => {
    const user = toSessionUser({
      id: 'b3f1c2d4-0000-4000-8000-000000000002',
      email: 'ze@example.com',
      appMetadata: { [LEGACY_UID_CLAIM]: 'u8aKQwjagaNTG9vgEX8uuJ9juVq1' },
      userMetadata: { name: 'Zé', picture: 'https://example.com/p.png', email_verified: true },
    })
    expect(user.uid).toBe('u8aKQwjagaNTG9vgEX8uuJ9juVq1')
    expect(user.authUserId).toBe('b3f1c2d4-0000-4000-8000-000000000002')
    expect(user.displayName).toBe('Zé')
    expect(user.picture).toBe('https://example.com/p.png')
  })

  it('never takes the app uid from user-editable metadata', () => {
    const user = toSessionUser({
      id: 'b3f1c2d4-0000-4000-8000-000000000003',
      appMetadata: {},
      userMetadata: { [LEGACY_UID_CLAIM]: 'someone-elses-uid', email_verified: true },
    })
    expect(user.uid).toBe('b3f1c2d4-0000-4000-8000-000000000003')
  })

  it('treats a missing or non-true email_verified as unverified', () => {
    const base = { id: 'x', appMetadata: undefined }
    expect(toSessionUser({ ...base, userMetadata: undefined }).emailVerified).toBe(false)
    expect(toSessionUser({ ...base, userMetadata: { email_verified: 'true' } }).emailVerified).toBe(
      false,
    )
  })

  it('ignores an empty legacy uid', () => {
    const user = toSessionUser({
      id: 'x',
      appMetadata: { [LEGACY_UID_CLAIM]: '' },
      userMetadata: {},
    })
    expect(user.uid).toBe('x')
  })
})
