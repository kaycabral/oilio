import { describe, expect, it } from 'vitest'
import { parseBranding } from './company-form'

// Cancellation-policy + confirmation-template parsing moved out of the Org form
// (PRD Identidade v2, context 3 — appointment-agenda concerns of the Unit). The
// Org form now only edits the folder fields (name/slug/vertical/branding), so
// this file covers branding only; the agenda configs are assembled in
// `units.actions` (assembleAgenda) with defaults.
function fd(entries: Record<string, string>): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(entries)) form.append(k, v)
  return form
}

describe('parseBranding', () => {
  it('returns empty update when no branding field is present', () => {
    expect(parseBranding(new FormData())).toEqual({})
  })

  it('maps empty url/description fields to null', () => {
    const result = parseBranding(
      fd({ brandingLogoUrl: '', brandingBannerUrl: '', brandingDescription: '' }),
    )
    expect(result).toEqual({ branding: { logoUrl: null, bannerUrl: null, description: null } })
  })

  it('keeps valid urls and description', () => {
    const result = parseBranding(
      fd({
        brandingLogoUrl: 'https://example.com/logo.png',
        brandingBannerUrl: 'https://example.com/banner.png',
        brandingDescription: 'Hello',
      }),
    )
    expect(result).toEqual({
      branding: {
        logoUrl: 'https://example.com/logo.png',
        bannerUrl: 'https://example.com/banner.png',
        description: 'Hello',
      },
    })
  })

  it('rejects an invalid logo url', () => {
    const result = parseBranding(fd({ brandingLogoUrl: 'not-a-url' }))
    expect(typeof result).toBe('string')
  })

  it('rejects an invalid banner url', () => {
    const result = parseBranding(fd({ brandingBannerUrl: 'ftp://nope' }))
    expect(typeof result).toBe('string')
  })

  it('rejects an over-long description', () => {
    const result = parseBranding(fd({ brandingDescription: 'x'.repeat(5000) }))
    expect(typeof result).toBe('string')
  })
})
