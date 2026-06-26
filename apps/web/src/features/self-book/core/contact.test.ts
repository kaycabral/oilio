import { describe, expect, it } from 'vitest'
import { isValidEmail } from './contact'

describe('isValidEmail', () => {
  it('accepts a plain address', () => {
    expect(isValidEmail('cliente@example.com')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false)
  })

  it('rejects missing @ or domain dot', () => {
    expect(isValidEmail('cliente.example.com')).toBe(false)
    expect(isValidEmail('cliente@example')).toBe(false)
  })

  it('rejects whitespace inside', () => {
    expect(isValidEmail('cli ente@example.com')).toBe(false)
  })

  it('rejects an over-long value (> 254 chars)', () => {
    const long = `${'a'.repeat(250)}@b.co`
    expect(isValidEmail(long)).toBe(false)
  })
})
