import { describe, expect, it } from 'vitest'
import {
  BRAZIL_MOBILE_E164_REGEX,
  formatBrazilPhone,
  maskBrazilPhone,
  normalizeBrazilMobile,
  normalizeBrazilPhone,
} from './phone'

describe('normalizeBrazilPhone', () => {
  it('strips formatting and prepends 55 for 11-digit mobile', () => {
    expect(normalizeBrazilPhone('(11) 91234-5678')).toBe('5511912345678')
  })

  it('prepends 55 for 10-digit landline', () => {
    expect(normalizeBrazilPhone('1112345678')).toBe('551112345678')
  })

  it('preserves 12 or 13 digit numbers (already with country code)', () => {
    expect(normalizeBrazilPhone('5511912345678')).toBe('5511912345678')
    expect(normalizeBrazilPhone('551112345678')).toBe('551112345678')
  })

  it('returns null for empty or non-numeric input', () => {
    expect(normalizeBrazilPhone('')).toBeNull()
    expect(normalizeBrazilPhone('---')).toBeNull()
  })

  it('returns null for clearly too-short input', () => {
    expect(normalizeBrazilPhone('12345')).toBeNull()
  })

  it('keeps a 12-digit number (already with country code)', () => {
    // '447911123456' is 12 digits → the explicit 12/13 branch.
    expect(normalizeBrazilPhone('+44 7911 123456')).toBe('447911123456')
  })

  it('keeps 14- and 15-digit numbers via the >=11 && <=15 E.164 fallback', () => {
    // Not 10/11/12/13 → exercises the generic length-11..15 branch.
    expect(normalizeBrazilPhone('12345678901234')).toBe('12345678901234')
    expect(normalizeBrazilPhone('123456789012345')).toBe('123456789012345')
  })

  it('returns null past the E.164 max of 15 digits', () => {
    expect(normalizeBrazilPhone('1234567890123456')).toBeNull()
  })
})

describe('normalizeBrazilMobile', () => {
  it('accepts an 11-digit domestic mobile and prepends 55', () => {
    expect(normalizeBrazilMobile('(11) 91234-5678')).toBe('5511912345678')
    expect(normalizeBrazilMobile('11912345678')).toBe('5511912345678')
  })

  it('accepts a 13-digit number already carrying the 55 country code', () => {
    expect(normalizeBrazilMobile('5511912345678')).toBe('5511912345678')
  })

  it('rejects a 10-digit landline (no 9th digit)', () => {
    expect(normalizeBrazilMobile('1133334444')).toBeNull()
    expect(normalizeBrazilMobile('551133334444')).toBeNull()
  })

  it('rejects an 11-digit number without the mandatory 9th digit', () => {
    // DDD 11 + 8 digits that do NOT start with 9 → not a mobile.
    expect(normalizeBrazilMobile('1181234567')).toBeNull()
    expect(normalizeBrazilMobile('11812345678')).toBeNull()
  })

  it('rejects too-short input (8 digits)', () => {
    expect(normalizeBrazilMobile('91234567')).toBeNull()
  })

  it('rejects empty / non-numeric input', () => {
    expect(normalizeBrazilMobile('')).toBeNull()
    expect(normalizeBrazilMobile('abc')).toBeNull()
  })

  it('rejects a foreign number (country code != 55)', () => {
    expect(normalizeBrazilMobile('447911123456')).toBeNull()
  })

  it('the regex matches exactly the E.164 mobile shape', () => {
    expect(BRAZIL_MOBILE_E164_REGEX.test('5511912345678')).toBe(true)
    expect(BRAZIL_MOBILE_E164_REGEX.test('551181234567')).toBe(false)
  })
})

describe('formatBrazilPhone', () => {
  it('formats mobile and landline, stripping the 55 country code', () => {
    expect(formatBrazilPhone('5511970000002')).toBe('(11) 97000-0002')
    expect(formatBrazilPhone('+55 11 97000-0002')).toBe('(11) 97000-0002')
    expect(formatBrazilPhone('1133334444')).toBe('(11) 3333-4444')
  })

  it('returns the input unchanged when it cannot be formatted', () => {
    expect(formatBrazilPhone('123')).toBe('123')
  })
})

describe('maskBrazilPhone', () => {
  it('progressively masks as digits are typed', () => {
    expect(maskBrazilPhone('')).toBe('')
    expect(maskBrazilPhone('11')).toBe('(11')
    expect(maskBrazilPhone('1199700')).toBe('(11) 9970-0')
    expect(maskBrazilPhone('11997000002')).toBe('(11) 99700-0002')
  })

  it('ignores non-digits and caps at 11 digits', () => {
    expect(maskBrazilPhone('(11) 99700-0002 extra')).toBe('(11) 99700-0002')
  })
})
