import { describe, expect, it } from 'vitest'
import { inviteEmailsMatch, normalizeInviteEmail } from './invite'

describe('normalizeInviteEmail', () => {
  it('lowercases and trims surrounding whitespace', () => {
    expect(normalizeInviteEmail('  Alice@Example.COM  ')).toBe('alice@example.com')
  })

  it('preserves dots and `+tag` suffixes (provider treats them as distinct)', () => {
    expect(normalizeInviteEmail('a.b+work@gmail.com')).toBe('a.b+work@gmail.com')
  })
})

describe('inviteEmailsMatch', () => {
  it('matches when the only differences are case + outer whitespace', () => {
    expect(inviteEmailsMatch('  Maria@Example.com ', 'maria@example.com')).toBe(true)
  })

  it('rejects different local parts even when domains agree', () => {
    expect(inviteEmailsMatch('maria@example.com', 'maria.lopes@example.com')).toBe(false)
  })

  it('rejects different domains', () => {
    expect(inviteEmailsMatch('maria@x.com', 'maria@y.com')).toBe(false)
  })

  it('rejects when the OAuth identity adds a `+tag` not present on the invite', () => {
    // False positive here would let `maria+attacker@x.com` accept an invite
    // addressed to `maria@x.com`. Both inboxes can be controlled by the same
    // person, but they're distinct identities at the provider level.
    expect(inviteEmailsMatch('maria+attacker@x.com', 'maria@x.com')).toBe(false)
  })
})
