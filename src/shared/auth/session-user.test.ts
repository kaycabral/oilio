import { describe, expect, it } from 'vitest'
import { LEGACY_UID_CLAIM, sessionUserFromSupabaseUser } from './session-user'

describe('sessionUserFromSupabaseUser', () => {
  it('uses the Supabase user id as the app uid for an account born on Supabase', () => {
    const user = sessionUserFromSupabaseUser({
      id: 'b3f1c2d4-0000-4000-8000-000000000001',
      email: 'ana@example.com',
      app_metadata: { provider: 'google' },
      user_metadata: {
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
    const user = sessionUserFromSupabaseUser({
      id: 'b3f1c2d4-0000-4000-8000-000000000002',
      email: 'ze@example.com',
      app_metadata: { [LEGACY_UID_CLAIM]: 'u8aKQwjagaNTG9vgEX8uuJ9juVq1' },
      user_metadata: { name: 'Zé', picture: 'https://example.com/p.png', email_verified: true },
    })
    expect(user.uid).toBe('u8aKQwjagaNTG9vgEX8uuJ9juVq1')
    expect(user.authUserId).toBe('b3f1c2d4-0000-4000-8000-000000000002')
    expect(user.displayName).toBe('Zé')
    expect(user.picture).toBe('https://example.com/p.png')
  })

  it('never takes the app uid from user-editable metadata', () => {
    const user = sessionUserFromSupabaseUser({
      id: 'b3f1c2d4-0000-4000-8000-000000000003',
      app_metadata: {},
      user_metadata: { [LEGACY_UID_CLAIM]: 'someone-elses-uid', email_verified: true },
    })
    expect(user.uid).toBe('b3f1c2d4-0000-4000-8000-000000000003')
  })

  it('ignores an empty or non-string legacy uid', () => {
    for (const legacy of ['', 42, null]) {
      const user = sessionUserFromSupabaseUser({
        id: 'x',
        app_metadata: { [LEGACY_UID_CLAIM]: legacy },
        user_metadata: {},
      })
      expect(user.uid).toBe('x')
    }
  })
})
