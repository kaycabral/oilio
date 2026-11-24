import { describe, expect, it } from 'vitest'
import { generateInviteToken, hashInviteToken, verifyInviteToken } from './invite-token'

describe('invite-token', () => {
  it('hash is stable for the same raw token', () => {
    const a = hashInviteToken('abc')
    const b = hashInviteToken('abc')
    expect(a).toBe(b)
  })

  it('verify accepts the matching raw token and rejects others', () => {
    const { raw, hash } = generateInviteToken()
    expect(verifyInviteToken(raw, hash)).toBe(true)
    expect(verifyInviteToken(`${raw}x`, hash)).toBe(false)
    expect(verifyInviteToken('nope', hash)).toBe(false)
  })

  it('generates URL-safe base64 tokens', () => {
    const { raw } = generateInviteToken()
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(raw.length).toBeGreaterThanOrEqual(40)
  })
})
