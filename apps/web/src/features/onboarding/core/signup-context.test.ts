import { describe, expect, it } from 'vitest'
import { resolveSignupOrgContext } from './signup-context'

describe('resolveSignupOrgContext (brief 0077 #1278)', () => {
  it('reads the slug from `from` on a signup-intent return URL', () => {
    const ctx = resolveSignupOrgContext('/signup/done?from=barbearia-x&cbrl_source=whatsapp')
    expect(ctx?.orgSlug).toBe('barbearia-x')
    expect(ctx?.attribution.source).toBe('whatsapp')
    expect(ctx?.attribution.intent).toBe('signup')
  })

  it('reads the slug from the first path segment on a booking-intent return URL', () => {
    const ctx = resolveSignupOrgContext(
      '/barbearia-x/centro/book?service=s1&cbrl_source=qr&cbrl_intent=booking',
    )
    expect(ctx?.orgSlug).toBe('barbearia-x')
    expect(ctx?.attribution.source).toBe('qr')
    expect(ctx?.attribution.intent).toBe('booking')
  })

  it('prefers `from` over the path segment when both are present', () => {
    const ctx = resolveSignupOrgContext('/signup?from=barbearia-x&cbrl_source=link')
    expect(ctx?.orgSlug).toBe('barbearia-x')
  })

  it('returns null for a plain platform path with no establishment context', () => {
    expect(resolveSignupOrgContext('/dashboard')).toBeNull()
  })

  it('returns null for a reserved first segment (not an org slug)', () => {
    // `signup` is reserved — a bare /signup with no `from` has no org.
    expect(resolveSignupOrgContext('/signup')).toBeNull()
    expect(resolveSignupOrgContext('/onboarding/profile')).toBeNull()
  })

  it('rejects a tampered absolute / protocol-relative next', () => {
    expect(resolveSignupOrgContext('//evil.com/barbearia-x')).toBeNull()
    expect(resolveSignupOrgContext('https://evil.com/barbearia-x')).toBeNull()
  })

  it('returns null for empty / nullish input', () => {
    expect(resolveSignupOrgContext('')).toBeNull()
    expect(resolveSignupOrgContext(null)).toBeNull()
    expect(resolveSignupOrgContext(undefined)).toBeNull()
  })

  it('rejects an invalid slug in `from`', () => {
    expect(resolveSignupOrgContext('/signup?from=Not_A_Slug!')).toBeNull()
  })
})
