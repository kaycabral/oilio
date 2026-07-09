import { describe, expect, it } from 'vitest'
import { normalizeServicePriceVisibility, normalizeServicePublicVisible } from './service'

describe('normalizeServicePublicVisible', () => {
  it('returns true only for the boolean literal true', () => {
    expect(normalizeServicePublicVisible(true)).toBe(true)
  })

  it('returns false for every non-true value (default-private)', () => {
    expect(normalizeServicePublicVisible(false)).toBe(false)
    expect(normalizeServicePublicVisible(undefined)).toBe(false)
    expect(normalizeServicePublicVisible(null)).toBe(false)
    expect(normalizeServicePublicVisible('true')).toBe(false)
    expect(normalizeServicePublicVisible(1)).toBe(false)
  })
})

describe('normalizeServicePriceVisibility', () => {
  it("returns 'visible' by default (undefined, null, malformed)", () => {
    expect(normalizeServicePriceVisibility(undefined)).toBe('visible')
    expect(normalizeServicePriceVisibility(null)).toBe('visible')
    expect(normalizeServicePriceVisibility('garbage')).toBe('visible')
    expect(normalizeServicePriceVisibility('visible')).toBe('visible')
  })

  it("returns 'on_request' when the field carries that literal", () => {
    expect(normalizeServicePriceVisibility('on_request')).toBe('on_request')
  })
})
