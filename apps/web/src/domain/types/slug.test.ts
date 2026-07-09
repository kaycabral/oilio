import { describe, expect, it } from 'vitest'
import { isReservedSlug, isValidSlug, SLUG_HTML_PATTERN, SLUG_PATTERN, slugify } from './slug'

const RESERVED = [
  'admin',
  'agenda',
  'api',
  'app',
  'auth',
  'blocks',
  'book',
  'booking',
  'cash',
  'orders',
  'company',
  'customers',
  'dashboard',
  'help',
  'home',
  'invites',
  'login',
  'logout',
  'new',
  'onboarding',
  'plans',
  'pricing',
  'products',
  'member_operations',
  'public',
  'receivables',
  'services',
  'settings',
  'signup',
  'subscriptions',
  'support',
  'team',
  'units',
  'wizard',
]

const ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['á', 'a'],
  ['à', 'a'],
  ['ã', 'a'],
  ['â', 'a'],
  ['ä', 'a'],
  ['é', 'e'],
  ['è', 'e'],
  ['ê', 'e'],
  ['ë', 'e'],
  ['í', 'i'],
  ['ì', 'i'],
  ['î', 'i'],
  ['ï', 'i'],
  ['ó', 'o'],
  ['ò', 'o'],
  ['õ', 'o'],
  ['ô', 'o'],
  ['ö', 'o'],
  ['ú', 'u'],
  ['ù', 'u'],
  ['û', 'u'],
  ['ü', 'u'],
  ['ç', 'c'],
  ['ñ', 'n'],
]

describe('slugify', () => {
  it('normalizes accents and lowercases', () => {
    expect(slugify('Barbearia João')).toBe('barbearia-joao')
    expect(slugify('Lavagem Açaí')).toBe('lavagem-acai')
  })

  it('collapses non-alphanumerics and trims dashes', () => {
    expect(slugify('  Hair   Studio!! ')).toBe('hair-studio')
    expect(slugify('@@foo bar##')).toBe('foo-bar')
  })

  it('maps every accent to its ASCII letter', () => {
    for (const [accented, ascii] of ACCENTS) {
      expect(slugify(accented)).toBe(ascii)
    }
  })

  it('clips to 64 chars', () => {
    const long = 'a'.repeat(80)
    expect(slugify(long)).toHaveLength(64)
  })
})

describe('SLUG_PATTERN', () => {
  it('accepts a single character (optional tail group)', () => {
    expect(SLUG_PATTERN.test('a')).toBe(true)
    expect(SLUG_PATTERN.test('ab')).toBe(true)
  })

  it('anchors to the whole string', () => {
    expect(SLUG_PATTERN.test('-a')).toBe(false)
    expect(SLUG_PATTERN.test('a-')).toBe(false)
    expect(SLUG_PATTERN.test('a b')).toBe(false)
  })

  it('compiles under the default engine flags (runtime .test path)', () => {
    expect(() => new RegExp(SLUG_PATTERN.source)).not.toThrow()
    expect(() => new RegExp(SLUG_PATTERN.source, 'u')).not.toThrow()
  })
})

describe('SLUG_HTML_PATTERN', () => {
  it('is the pattern source, anchors stripped and hyphen escaped for the v flag', () => {
    expect(SLUG_HTML_PATTERN).toBe('[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?')
    expect(SLUG_HTML_PATTERN.startsWith('^')).toBe(false)
    expect(SLUG_HTML_PATTERN.endsWith('$')).toBe(false)
  })

  it('compiles under the v (unicodeSets) flag, unlike the raw SLUG_PATTERN source (#1295)', () => {
    expect(() => new RegExp(SLUG_PATTERN.source, 'v')).toThrow()
    expect(() => new RegExp(SLUG_HTML_PATTERN, 'v')).not.toThrow()
  })

  it('accepts/rejects the same values as SLUG_PATTERN when anchored', () => {
    const asAttr = new RegExp(`^(?:${SLUG_HTML_PATTERN})$`, 'v')
    for (const good of ['a', 'ab', 'barbearia-joao', '1-2-3']) {
      expect(asAttr.test(good)).toBe(SLUG_PATTERN.test(good))
      expect(asAttr.test(good)).toBe(true)
    }
    for (const bad of ['-a', 'a-', 'a b', 'UPPER']) {
      expect(asAttr.test(bad)).toBe(SLUG_PATTERN.test(bad))
      expect(asAttr.test(bad)).toBe(false)
    }
  })
})

describe('isReservedSlug', () => {
  it('reserves every app-route slug', () => {
    for (const slug of RESERVED) {
      expect(isReservedSlug(slug)).toBe(true)
    }
  })

  it('does not reserve an arbitrary org slug', () => {
    expect(isReservedSlug('barbearia-joao')).toBe(false)
  })
})

describe('isValidSlug', () => {
  it('accepts canonical slugs', () => {
    expect(isValidSlug('barbearia-joao')).toBe(true)
    expect(isValidSlug('abc')).toBe(true)
    expect(isValidSlug('1-2-3')).toBe(true)
  })

  it('honors the length bounds at the boundary', () => {
    expect(isValidSlug('ab')).toBe(false)
    expect(isValidSlug('abc')).toBe(true)
    expect(isValidSlug('a'.repeat(64))).toBe(true)
    expect(isValidSlug('a'.repeat(65))).toBe(false)
  })

  it('rejects bad characters and edge dashes', () => {
    expect(isValidSlug('UPPER')).toBe(false)
    expect(isValidSlug('-foo')).toBe(false)
    expect(isValidSlug('foo-')).toBe(false)
    expect(isValidSlug('foo bar')).toBe(false)
  })

  it('rejects reserved slugs that conflict with app routes', () => {
    expect(isValidSlug('login')).toBe(false)
    expect(isValidSlug('dashboard')).toBe(false)
    expect(isValidSlug('api')).toBe(false)
    expect(isReservedSlug('onboarding')).toBe(true)
  })
})
