import { describe, expect, it } from 'vitest'
import { resolveFallback, validateGtin } from './validate'

describe('validateGtin — accept + normalize to GTIN-14', () => {
  it.each([
    ['4006381333931', '04006381333931', 'EAN-13'],
    ['036000291452', '00036000291452', 'UPC-A 12'],
    ['40015132', '00000040015132', 'EAN-8 (normal)'],
    ['17890012345677', '17890012345677', 'GTIN-14 (already 14)'],
    ['9783161484100', '09783161484100', 'ISBN-13 (978) → normal EAN-13'],
    ['9791012345678', '09791012345678', 'ISBN-13/ISMN (979)'],
    ['9770123456787', '09770123456787', 'ISSN (977)'],
  ])('normalizes %s → %s (%s)', (input, expected) => {
    const result = validateGtin(input)
    expect(result).toEqual({ kind: 'valid', gtin14: expected })
  })

  it('strips spaces and hyphens before validating (scanner / human separators)', () => {
    expect(validateGtin('4-006381 333931')).toEqual({
      kind: 'valid',
      gtin14: '04006381333931',
    })
  })

  it('preserves the check digit under padding (never recomputes)', () => {
    const result = validateGtin('4006381333931')
    expect(result).toEqual({ kind: 'valid', gtin14: '04006381333931' })
    if (result.kind === 'valid') expect(result.gtin14.endsWith('1')).toBe(true)
  })
})

describe('validateGtin — rejections with typed reason', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['12ab34cd', 'non-numeric'],
    ['12345', 'invalid-length'],
    ['123456789012345', 'invalid-length'],
    ['4006381333932', 'check-digit'],
    ['20015138', 'restricted-circulation'],
    ['0401234567893', 'restricted-circulation'],
    ['9811234567891', 'coupon-or-receipt'],
    ['9801234567892', 'coupon-or-receipt'],
  ] as const)('rejects %s with reason %s', (input, reason) => {
    expect(validateGtin(input)).toEqual({ kind: 'rejected', reason })
  })
})

describe('resolveFallback — brand+MPN for items without a real GTIN', () => {
  it('builds a normalized composite key', () => {
    expect(resolveFallback('  Acme  ', ' XR-200 ')).toEqual({
      kind: 'fallback',
      brand: 'Acme',
      mpn: 'XR-200',
      key: 'acme::xr-200',
    })
  })

  it('normalizes case and collapses internal whitespace in the key', () => {
    const a = resolveFallback('Acme Co', 'Part 1')
    const b = resolveFallback('ACME  CO', 'PART  1')
    expect(a?.key).toBe(b?.key)
  })

  it('returns null when either part is blank', () => {
    expect(resolveFallback('', 'XR-200')).toBeNull()
    expect(resolveFallback('Acme', '   ')).toBeNull()
  })

  it('never produces a GTIN (kind is fallback, not valid)', () => {
    const r = resolveFallback('Acme', 'XR-200')
    expect(r?.kind).toBe('fallback')
  })
})
