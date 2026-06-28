import { describe, expect, it } from 'vitest'
import { isReservedSlug, isValidSlug, SLUG_PATTERN, slugify } from './slug'

// Hardcoded (NOT derived from the source Set/Map) so a blanked entry is caught:
// iterating the mutated collection would assert against the mutated value and
// pass vacuously.
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
