import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_MAX_LEN,
  ATTRIBUTION_PARAM,
  type Attribution,
  attributionForEvent,
  attributionFromParams,
  attributionToSearchParams,
  sanitizeAttributionValue,
} from './attribution'

// Build a reader over a plain record for `attributionFromParams`.
function reader(bag: Record<string, string>): (key: string) => string | null {
  return (key) => bag[key] ?? null
}

describe('sanitizeAttributionValue (brief 0077 AC-13)', () => {
  it('lowercases and keeps slug separators', () => {
    expect(sanitizeAttributionValue('Verao-2026.promo_v2')).toBe('verao-2026.promo_v2')
  })

  it('strips spaces, punctuation, unicode and injection chars', () => {
    // `<b>oi</b> açaí!` → angle-brackets/slash/space/! dropped, accented vowels
    // dropped (not in the allowlist): <b>→b, oi, </b>→b, açaí→aa.
    expect(sanitizeAttributionValue('  <b>oi</b> açaí! ')).toBe('boibaa')
  })

  it('keeps a bare slug untouched (already clean)', () => {
    expect(sanitizeAttributionValue('verao')).toBe('verao')
  })

  it('caps length at ATTRIBUTION_MAX_LEN', () => {
    const long = 'a'.repeat(ATTRIBUTION_MAX_LEN + 50)
    expect(sanitizeAttributionValue(long)).toHaveLength(ATTRIBUTION_MAX_LEN)
  })

  it('maps null/empty/whitespace-only to null', () => {
    expect(sanitizeAttributionValue(null)).toBeNull()
    expect(sanitizeAttributionValue(undefined)).toBeNull()
    expect(sanitizeAttributionValue('   ')).toBeNull()
    // all-stripped → null, not ""
    expect(sanitizeAttributionValue('!!!')).toBeNull()
  })
})

describe('attributionFromParams', () => {
  it('reads the standard utm_* params and defaults intent to signup', () => {
    const a = attributionFromParams(
      reader({
        [ATTRIBUTION_PARAM.source]: 'qr',
        [ATTRIBUTION_PARAM.medium]: 'invite',
        [ATTRIBUTION_PARAM.campaign]: 'verao',
        [ATTRIBUTION_PARAM.actorId]: 'owner-uid-123',
      }),
    )
    expect(a).toEqual<Attribution>({
      source: 'qr',
      medium: 'invite',
      campaign: 'verao',
      content: null,
      term: null,
      actorId: 'owner-uid-123',
      intent: 'signup',
    })
  })

  it('honors explicit booking intent', () => {
    const a = attributionFromParams(reader({ [ATTRIBUTION_PARAM.intent]: 'booking' }))
    expect(a.intent).toBe('booking')
  })

  it('coerces an unknown intent to signup', () => {
    const a = attributionFromParams(reader({ [ATTRIBUTION_PARAM.intent]: 'garbage' }))
    expect(a.intent).toBe('signup')
  })

  it('falls back to the legacy cbrl_* alias when the utm_* axis is absent', () => {
    const a = attributionFromParams(
      reader({ cbrl_source: 'instagram', cbrl_medium: 'social', cbrl_campaign: 'promo' }),
    )
    expect(a.source).toBe('instagram')
    expect(a.medium).toBe('social')
    expect(a.campaign).toBe('promo')
  })

  it('prefers the standard utm_* axis over the legacy cbrl_* alias', () => {
    const a = attributionFromParams(
      reader({ [ATTRIBUTION_PARAM.source]: 'qr', cbrl_source: 'instagram' }),
    )
    expect(a.source).toBe('qr')
  })

  it('sanitizes a tampered axis on the way in', () => {
    const a = attributionFromParams(reader({ [ATTRIBUTION_PARAM.campaign]: '<script>x</script>' }))
    expect(a.campaign).toBe('scriptxscript')
  })
})

describe('attributionToSearchParams', () => {
  it('emits only non-null axes plus the intent', () => {
    const params = attributionToSearchParams({
      source: 'qr',
      medium: null,
      campaign: 'verao',
      content: null,
      term: null,
      actorId: 'owner-1',
      intent: 'booking',
    })
    expect(params.get(ATTRIBUTION_PARAM.source)).toBe('qr')
    expect(params.get(ATTRIBUTION_PARAM.campaign)).toBe('verao')
    expect(params.get(ATTRIBUTION_PARAM.actorId)).toBe('owner-1')
    expect(params.get(ATTRIBUTION_PARAM.intent)).toBe('booking')
    expect(params.has(ATTRIBUTION_PARAM.medium)).toBe(false)
    expect(params.has(ATTRIBUTION_PARAM.content)).toBe(false)
  })

  it('round-trips through fromParams', () => {
    const original: Attribution = {
      source: 'whatsapp',
      medium: 'invite',
      campaign: 'indicacao',
      content: null,
      term: null,
      actorId: 'recep-9',
      intent: 'signup',
    }
    const params = attributionToSearchParams(original)
    const back = attributionFromParams((k) => params.get(k))
    expect(back).toEqual(original)
  })
})

describe('attributionForEvent (PII-zero wall, AC-12)', () => {
  it('projects only the channel axes', () => {
    expect(
      attributionForEvent({
        source: 'qr',
        medium: 'invite',
        campaign: 'verao',
        content: 'banner',
        term: 'kw',
        actorId: 'owner-1',
        intent: 'signup',
      }),
    ).toEqual({ source: 'qr', medium: 'invite', campaign: 'verao' })
  })
})
