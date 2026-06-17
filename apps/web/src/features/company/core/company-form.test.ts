import { DEFAULT_CANCELLATION_POLICY, MAX_CANCELLATION_NOTICE_MINUTES } from '@/domain'
import { describe, expect, it } from 'vitest'
import { parseBranding, parseCancellationPolicy, parseWhatsappTemplates } from './company-form'

function fd(entries: Record<string, string>): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(entries)) form.append(k, v)
  return form
}

describe('parseCancellationPolicy', () => {
  it('returns empty update when the minutes field is absent', () => {
    expect(parseCancellationPolicy(new FormData())).toEqual({})
  })

  it('parses an enabled policy with valid minutes', () => {
    const result = parseCancellationPolicy(
      fd({ cancellationPolicyMinNoticeMinutes: '120', cancellationPolicyEnabled: 'on' }),
    )
    expect(result).toEqual({ cancellationPolicy: { enabled: true, minNoticeMinutes: 120 } })
  })

  it('rejects enabled policy with out-of-range minutes', () => {
    const result = parseCancellationPolicy(
      fd({
        cancellationPolicyMinNoticeMinutes: String(MAX_CANCELLATION_NOTICE_MINUTES + 1),
        cancellationPolicyEnabled: 'on',
      }),
    )
    expect(typeof result).toBe('string')
  })

  it('disabled toggle keeps the value but ignores invalidity, falling back to default', () => {
    const result = parseCancellationPolicy(fd({ cancellationPolicyMinNoticeMinutes: 'abc' }))
    expect(result).toEqual({
      cancellationPolicy: {
        enabled: false,
        minNoticeMinutes: DEFAULT_CANCELLATION_POLICY.minNoticeMinutes,
      },
    })
  })
})

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

describe('parseWhatsappTemplates', () => {
  it('returns empty update when the field is absent', () => {
    expect(parseWhatsappTemplates(new FormData())).toEqual({})
  })

  it('resolves templates when the field is present', () => {
    const result = parseWhatsappTemplates(fd({ whatsappConfirmation: 'Olá {{name}}' }))
    expect(result).toHaveProperty('whatsappTemplates')
  })
})
