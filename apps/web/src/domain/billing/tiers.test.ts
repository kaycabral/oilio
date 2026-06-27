import { describe, expect, it } from 'vitest'

import { BILLING_CYCLES, isAtLeast, TIER_ORDER, tierLevel, TIERS } from './tiers'

describe('billing tiers', () => {
  it('exposes exactly the three chargeable tiers (Rede is not a billing tier)', () => {
    expect(TIERS).toEqual(['free', 'pro', 'advanced'])
  })

  it('exposes the two billing cycles', () => {
    expect(BILLING_CYCLES).toEqual(['monthly', 'annual'])
  })

  it('orders tiers ascending by unlocked value', () => {
    expect(TIER_ORDER).toEqual(['free', 'pro', 'advanced'])
    expect(tierLevel('free')).toBe(0)
    expect(tierLevel('pro')).toBe(1)
    expect(tierLevel('advanced')).toBe(2)
  })

  describe('isAtLeast', () => {
    it('is true when actual outranks or equals required', () => {
      expect(isAtLeast('pro', 'free')).toBe(true)
      expect(isAtLeast('advanced', 'pro')).toBe(true)
      expect(isAtLeast('pro', 'pro')).toBe(true)
      expect(isAtLeast('free', 'free')).toBe(true)
    })

    it('is false when actual is below required', () => {
      expect(isAtLeast('free', 'pro')).toBe(false)
      expect(isAtLeast('pro', 'advanced')).toBe(false)
      expect(isAtLeast('free', 'advanced')).toBe(false)
    })
  })
})
