import { describe, expect, it } from 'vitest'
import { isReservedUnitSlug, isValidUnitSlug, slugifyUnitName } from './unit'

describe('slugifyUnitName', () => {
  it('normalizes accents and lowercases', () => {
    expect(slugifyUnitName('Filial São Paulo')).toBe('filial-sao-paulo')
    expect(slugifyUnitName('Centro Açaí')).toBe('centro-acai')
  })

  it('collapses non-alphanumerics and trims dashes', () => {
    expect(slugifyUnitName('  Matriz!!! ')).toBe('matriz')
  })
})

describe('isValidUnitSlug', () => {
  it('accepts canonical slugs', () => {
    expect(isValidUnitSlug('matriz')).toBe(true)
    expect(isValidUnitSlug('filial-centro')).toBe(true)
    expect(isValidUnitSlug('zona-sul-2')).toBe(true)
  })

  it('rejects bad format', () => {
    expect(isValidUnitSlug('ab')).toBe(false)
    expect(isValidUnitSlug('UPPER')).toBe(false)
    expect(isValidUnitSlug('-foo')).toBe(false)
    expect(isValidUnitSlug('foo bar')).toBe(false)
  })

  it('rejects reserved unit-scoped slugs', () => {
    expect(isValidUnitSlug('book')).toBe(false)
    expect(isValidUnitSlug('booking')).toBe(false)
    expect(isValidUnitSlug('me')).toBe(false)
    expect(isValidUnitSlug('admin')).toBe(false)
    expect(isReservedUnitSlug('book')).toBe(true)
    expect(isReservedUnitSlug('hello')).toBe(false)
  })

  it('rejects slugs that are reserved at the top-level (transitively, via isValidSlug)', () => {
    // `login` is reserved at top-level; isValidSlug rejects, so isValidUnitSlug
    // also rejects — keeps consistency between namespaces.
    expect(isValidUnitSlug('login')).toBe(false)
  })
})
