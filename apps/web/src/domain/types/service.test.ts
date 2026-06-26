import { describe, expect, it } from 'vitest'
import { normalizeServicePriceVisibility, normalizeServicePublicVisible } from './service'

// Read-side normalizers for the catalog value objects (price/public visibility).
// The legacy split types + their per-unit resolver/public projection were
// removed in brief 0053 (B3) — that behaviour lives on in
// `resolveCatalogItemForUnit`/`toPublicCatalogItem` (catalog-item-adapters.test.ts).

describe('normalizeServicePublicVisible', () => {
  it('returns true only for the boolean literal true', () => {
    expect(normalizeServicePublicVisible(true)).toBe(true)
  })

  it('returns false for every non-true value (default-private)', () => {
    // Legacy/malformed docs must NOT leak into the public catalog: anything
    // that isn't strictly `true` is treated as not public.
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
