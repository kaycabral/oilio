import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { INVITE_TTL_MS, StoredInvite } from './invite'

const decode = Schema.decodeUnknownEither(StoredInvite)

function storedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv-1',
    orgId: 'org-1',
    role: 'member_operator',
    tokenHash: 'hash',
    expiresAt: '2026-07-05T00:00:00.000Z',
    status: 'pending',
    invitedBy: 'owner-1',
    acceptedByUid: null,
    acceptedAt: null,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    ...over,
  }
}

describe('StoredInvite acceptance consistency (first-accept-wins guard)', () => {
  it('accepts a pending invite with no accepter', () => {
    expect(decode(storedRow())._tag).toBe('Right')
  })

  it('accepts an accepted invite that carries who + when', () => {
    const row = storedRow({
      status: 'accepted',
      acceptedByUid: 'uid-42',
      acceptedAt: '2026-07-04T00:00:00.000Z',
    })
    expect(decode(row)._tag).toBe('Right')
  })

  it('rejects a pending invite that already names an accepter (leaked accept)', () => {
    expect(decode(storedRow({ acceptedByUid: 'uid-42' }))._tag).toBe('Left')
  })

  it('rejects an accepted invite with no accepter (accepted sem quem/quando)', () => {
    expect(decode(storedRow({ status: 'accepted' }))._tag).toBe('Left')
  })
})

describe('INVITE_TTL_MS', () => {
  it('is 48h — the signed token is the primary lock, so the window is short', () => {
    expect(INVITE_TTL_MS).toBe(48 * 60 * 60 * 1000)
  })
})
