import { describe, expect, it } from 'vitest'
import { classifyPrefix } from './prefix'

describe('classifyPrefix', () => {
  describe('accepts legitimate global GTINs', () => {
    it.each([
      ['4006381333931', 'EAN-13 generic'],
      ['036000291452', 'UPC-A 12'],
      ['40015132', 'EAN-8 normal (lead 4)'],
      ['17890012345677', 'GTIN-14 indicator 1'],
      ['9783161484100', 'ISBN-13 (978 Bookland)'],
      ['9791012345678', 'ISBN-13/ISMN (979)'],
      ['9770123456787', 'ISSN (977)'],
    ])('accepts %s — %s', (gtin) => {
      expect(classifyPrefix(gtin)).toBe('accept')
    })
  })

  describe('rejects restricted-circulation numbers (RCN)', () => {
    it.each([
      ['20015138', 'EAN-8 RCN lead 2'],
      ['00015134', 'EAN-8 RCN lead 0'],
      ['0201234567899', '020–029 region RCN'],
      ['0401234567893', '040–049 company RCN'],
      ['0501234567890', '050–059 reserved'],
      ['2501234567898', '200–299 region RCN'],
    ])('rejects %s — %s', (gtin) => {
      expect(classifyPrefix(gtin)).toBe('restricted-circulation')
    })
  })

  describe('rejects coupon / receipt numbers', () => {
    it.each([
      ['9801234567892', '980 receipts'],
      ['9811234567891', '981 coupon'],
      ['9901234567899', '990 coupon'],
      ['9991234567890', '999 coupon'],
    ])('rejects %s — %s', (gtin) => {
      expect(classifyPrefix(gtin)).toBe('coupon-or-receipt')
    })
  })

  it('does NOT confuse Bookland 978/979 with the 98x coupon band (3-digit match)', () => {
    // The classic trap: a 2-digit "98" match would wrongly kill ISBN. Matching on
    // 3 digits keeps 977/978/979 accepted while 980/981–984/990–999 are rejected.
    expect(classifyPrefix('9783161484100')).toBe('accept')
    expect(classifyPrefix('9791012345678')).toBe('accept')
    expect(classifyPrefix('9801234567892')).toBe('coupon-or-receipt')
  })

  it('returns accept for an unexpected length (caller validates length first)', () => {
    expect(classifyPrefix('123')).toBe('accept')
  })
})
