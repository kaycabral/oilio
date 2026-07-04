import { describe, expect, it } from 'vitest'

import { CAPABILITIES, type Capability, TIER_CAPABILITIES, hasCapability } from './capabilities'
import { TIERS, type Tier } from './tiers'

describe('billing capabilities', () => {
  it('Free has no gated capabilities (ungated baseline)', () => {
    expect(TIER_CAPABILITIES.free.size).toBe(0)
  })

  it('Pro unlocks the six paid capabilities', () => {
    expect([...TIER_CAPABILITIES.pro].sort()).toEqual(
      [
        'commissions',
        'copilot.profit_goal',
        'plans.recurring',
        'reports.sales',
        'units.unlimited',
        'team.unlimited',
      ].sort(),
    )
  })

  it('Avançado is a strict superset of Pro (adds support.priority)', () => {
    for (const cap of TIER_CAPABILITIES.pro) {
      expect(TIER_CAPABILITIES.advanced.has(cap)).toBe(true)
    }
    expect(TIER_CAPABILITIES.advanced.has('support.priority')).toBe(true)
    expect(TIER_CAPABILITIES.pro.has('support.priority')).toBe(false)
    expect(TIER_CAPABILITIES.advanced.size).toBe(TIER_CAPABILITIES.pro.size + 1)
  })

  it('does NOT expose "Em breve" roadmap items as capabilities (AC-04)', () => {
    const roadmap = ['charge.automatic', 'payment.split', 'reconciliation', 'reports.multiunit']
    for (const item of roadmap) {
      expect((CAPABILITIES as readonly string[]).includes(item)).toBe(false)
    }
  })

  describe('hasCapability — full 3 tiers × 6 capabilities matrix', () => {
    const expected: Record<Tier, Record<Capability, boolean>> = {
      free: {
        'plans.recurring': false,
        commissions: false,
        'copilot.profit_goal': false,
        'reports.sales': false,
        'units.unlimited': false,
        'team.unlimited': false,
        'support.priority': false,
      },
      pro: {
        'plans.recurring': true,
        commissions: true,
        'copilot.profit_goal': true,
        'reports.sales': true,
        'units.unlimited': true,
        'team.unlimited': true,
        'support.priority': false,
      },
      advanced: {
        'plans.recurring': true,
        commissions: true,
        'copilot.profit_goal': true,
        'reports.sales': true,
        'units.unlimited': true,
        'team.unlimited': true,
        'support.priority': true,
      },
    }

    for (const tier of TIERS) {
      for (const cap of CAPABILITIES) {
        it(`${tier} / ${cap} → ${expected[tier][cap]}`, () => {
          expect(hasCapability(tier, cap)).toBe(expected[tier][cap])
        })
      }
    }
  })
})
