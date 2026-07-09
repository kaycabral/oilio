import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORG_BRANDING,
  ORG_DESCRIPTION_MAX,
  isValidPublicHttpUrl,
  normalizeOrgBranding,
} from './org'

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

describe('normalizeOrgBranding', () => {
  it('returns default branding for null/undefined', () => {
    expect(normalizeOrgBranding(null)).toEqual(DEFAULT_ORG_BRANDING)
    expect(normalizeOrgBranding(undefined)).toEqual(DEFAULT_ORG_BRANDING)
  })

  it('coerces invalid URLs to null', () => {
    const r = normalizeOrgBranding({
      logoUrl: 'javascript:foo',
      bannerUrl: 'https://ok.example.com/b.jpg',
      description: 'Hello',
    })
    expect(r.logoUrl).toBeNull()
    expect(r.bannerUrl).toBe('https://ok.example.com/b.jpg')
    expect(r.description).toBe('Hello')
  })

  it('trims description and clips to ORG_DESCRIPTION_MAX', () => {
    const long = 'x'.repeat(ORG_DESCRIPTION_MAX + 50)
    const r = normalizeOrgBranding({
      logoUrl: null,
      bannerUrl: null,
      description: `   ${long}   `,
    })
    expect(r.description).toHaveLength(ORG_DESCRIPTION_MAX)
  })

  it('returns null description for empty strings', () => {
    expect(normalizeOrgBranding({ description: '   ' }).description).toBeNull()
    expect(normalizeOrgBranding({ description: '' }).description).toBeNull()
  })
})
