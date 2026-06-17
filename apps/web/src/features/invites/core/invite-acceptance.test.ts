import type { Invite } from '@/domain'
import { describe, expect, it } from 'vitest'
import { checkInviteEligibility } from './invite-acceptance'

const now = new Date('2026-06-12T12:00:00Z')

function invite(
  overrides: Partial<Pick<Invite, 'status' | 'expiresAt' | 'email'>> = {},
): Pick<Invite, 'status' | 'expiresAt' | 'email'> {
  return {
    status: 'pending',
    expiresAt: '2026-06-19T12:00:00Z',
    email: 'joana@example.com',
    ...overrides,
  }
}

describe('checkInviteEligibility', () => {
  it('accepts a pending, unexpired invite with matching email', () => {
    expect(checkInviteEligibility(invite(), 'joana@example.com', now)).toEqual({ ok: true })
  })

  it('matches email case-insensitively', () => {
    expect(checkInviteEligibility(invite(), 'Joana@Example.com', now)).toEqual({ ok: true })
  })

  it('rejects a non-pending invite', () => {
    expect(
      checkInviteEligibility(invite({ status: 'accepted' }), 'joana@example.com', now),
    ).toEqual({
      ok: false,
      reason: 'not_pending',
    })
  })

  it('rejects an expired invite', () => {
    expect(
      checkInviteEligibility(
        invite({ expiresAt: '2026-06-01T00:00:00Z' }),
        'joana@example.com',
        now,
      ),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a mismatched email', () => {
    expect(checkInviteEligibility(invite(), 'other@example.com', now)).toEqual({
      ok: false,
      reason: 'email_mismatch',
    })
  })

  it('rejects a null session email', () => {
    expect(checkInviteEligibility(invite(), null, now)).toEqual({
      ok: false,
      reason: 'email_mismatch',
    })
  })
})
