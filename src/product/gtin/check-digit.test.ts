import { describe, expect, it } from 'vitest'
import { computeCheckDigit, hasValidCheckDigit } from './check-digit'

describe('computeCheckDigit (GS1 mod-10, right-anchored ×3,1)', () => {
  it.each([
    ['400638133393', 1],
    ['4001513', 2],
    ['03600029145', 2],
    ['1040123456789', 0],
    ['978316148410', 0],
  ])('computes check digit for %s as %i', (data, expected) => {
    expect(computeCheckDigit(data)).toBe(expected)
  })

  it('returns 0 when the weighted sum is a multiple of 10', () => {
    expect(computeCheckDigit('978316148410')).toBe(0)
  })
})

describe('hasValidCheckDigit', () => {
  it.each([
    '4006381333931',
    '40015132',
    '036000291452',
    '10401234567890',
    '9783161484100',
    '9770123456787',
  ])('accepts GS1-valid %s', (gtin) => {
    expect(hasValidCheckDigit(gtin)).toBe(true)
  })

  it('rejects a GTIN whose check digit was tampered', () => {
    expect(hasValidCheckDigit('4006381333932')).toBe(false)
  })

  it('is invariant to left zero-padding (the normalize-to-14 guarantee)', () => {
    expect(hasValidCheckDigit('4006381333931')).toBe(true)
    expect(hasValidCheckDigit('00004006381333931'.slice(-14))).toBe(
      hasValidCheckDigit('4006381333931'.padStart(14, '0')),
    )
    expect(hasValidCheckDigit('4006381333931'.padStart(14, '0'))).toBe(true)
  })
})
