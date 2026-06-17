import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_TENANT_BRANDING,
  MAX_CANCELLATION_NOTICE_MINUTES,
  MIN_CANCELLATION_NOTICE_MINUTES,
  TENANT_DESCRIPTION_MAX,
  isValidCancellationNoticeMinutes,
  isValidPublicHttpUrl,
  normalizeCancellationPolicy,
  normalizeTenantBranding,
} from './tenant'

describe('isValidPublicHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isValidPublicHttpUrl('https://cdn.example.com/logo.png')).toBe(true)
    expect(isValidPublicHttpUrl('http://example.com')).toBe(true)
  })

  it('rejects other protocols', () => {
    expect(isValidPublicHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isValidPublicHttpUrl('ftp://example.com')).toBe(false)
    expect(isValidPublicHttpUrl('data:image/png;base64,xxx')).toBe(false)
  })

  it('rejects empty and overly long', () => {
    expect(isValidPublicHttpUrl('')).toBe(false)
    expect(isValidPublicHttpUrl('a'.repeat(2049))).toBe(false)
  })

  it('rejects non-strings and malformed', () => {
    expect(isValidPublicHttpUrl(null)).toBe(false)
    expect(isValidPublicHttpUrl(123)).toBe(false)
    expect(isValidPublicHttpUrl('not a url')).toBe(false)
  })
})

describe('normalizeTenantBranding', () => {
  it('returns default branding for null/undefined', () => {
    expect(normalizeTenantBranding(null)).toEqual(DEFAULT_TENANT_BRANDING)
    expect(normalizeTenantBranding(undefined)).toEqual(DEFAULT_TENANT_BRANDING)
  })

  it('coerces invalid URLs to null', () => {
    const r = normalizeTenantBranding({
      logoUrl: 'javascript:foo',
      bannerUrl: 'https://ok.example.com/b.jpg',
      description: 'Hello',
    })
    expect(r.logoUrl).toBeNull()
    expect(r.bannerUrl).toBe('https://ok.example.com/b.jpg')
    expect(r.description).toBe('Hello')
  })

  it('trims description and clips to TENANT_DESCRIPTION_MAX', () => {
    const long = 'x'.repeat(TENANT_DESCRIPTION_MAX + 50)
    const r = normalizeTenantBranding({
      logoUrl: null,
      bannerUrl: null,
      description: `   ${long}   `,
    })
    expect(r.description).toHaveLength(TENANT_DESCRIPTION_MAX)
  })

  it('returns null description for empty strings', () => {
    expect(normalizeTenantBranding({ description: '   ' }).description).toBeNull()
    expect(normalizeTenantBranding({ description: '' }).description).toBeNull()
  })
})

describe('isValidCancellationNoticeMinutes', () => {
  it('accepts non-negative integers within the bounded range', () => {
    expect(isValidCancellationNoticeMinutes(0)).toBe(true)
    expect(isValidCancellationNoticeMinutes(120)).toBe(true)
    expect(isValidCancellationNoticeMinutes(MIN_CANCELLATION_NOTICE_MINUTES)).toBe(true)
    expect(isValidCancellationNoticeMinutes(MAX_CANCELLATION_NOTICE_MINUTES)).toBe(true)
  })

  it('rejects negative, out-of-range, non-integer or non-number values', () => {
    expect(isValidCancellationNoticeMinutes(-1)).toBe(false)
    expect(isValidCancellationNoticeMinutes(MAX_CANCELLATION_NOTICE_MINUTES + 1)).toBe(false)
    expect(isValidCancellationNoticeMinutes(60.5)).toBe(false)
    expect(isValidCancellationNoticeMinutes('120')).toBe(false)
    expect(isValidCancellationNoticeMinutes(Number.NaN)).toBe(false)
    expect(isValidCancellationNoticeMinutes(null)).toBe(false)
  })
})

describe('normalizeCancellationPolicy', () => {
  it('returns the default policy when input is null/undefined or not an object', () => {
    expect(normalizeCancellationPolicy(null)).toEqual(DEFAULT_CANCELLATION_POLICY)
    expect(normalizeCancellationPolicy(undefined)).toEqual(DEFAULT_CANCELLATION_POLICY)
    expect(normalizeCancellationPolicy('not-an-object')).toEqual(DEFAULT_CANCELLATION_POLICY)
  })

  it('keeps valid fields and falls back to defaults for invalid ones', () => {
    expect(normalizeCancellationPolicy({ enabled: true, minNoticeMinutes: 30 })).toEqual({
      enabled: true,
      minNoticeMinutes: 30,
    })
    expect(normalizeCancellationPolicy({ enabled: 'sim', minNoticeMinutes: -10 })).toEqual({
      enabled: DEFAULT_CANCELLATION_POLICY.enabled,
      minNoticeMinutes: DEFAULT_CANCELLATION_POLICY.minNoticeMinutes,
    })
  })

  it('preserves minNoticeMinutes when enabled is false (so re-enable restores the value)', () => {
    expect(normalizeCancellationPolicy({ enabled: false, minNoticeMinutes: 240 })).toEqual({
      enabled: false,
      minNoticeMinutes: 240,
    })
  })
})
