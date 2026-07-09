import { describe, expect, it } from 'vitest'
import { lawfulPriceCents } from './lawful-price'

describe('lawfulPriceCents (brief 0033 AC-09)', () => {
  it('charges the displayed price when the current price rose above it', () => {
    expect(lawfulPriceCents(5000, 8000)).toBe(5000)
  })

  it('charges the current price when it dropped below the displayed price', () => {
    expect(lawfulPriceCents(5000, 3000)).toBe(3000)
  })

  it('charges either when they are equal (no divergence)', () => {
    expect(lawfulPriceCents(5000, 5000)).toBe(5000)
  })

  it('falls back to the current price when no displayed price was threaded', () => {
    expect(lawfulPriceCents(null, 4200)).toBe(4200)
  })

  it('treats a displayed price of 0 as a real ceiling (not absent)', () => {
    expect(lawfulPriceCents(0, 5000)).toBe(0)
  })
})
