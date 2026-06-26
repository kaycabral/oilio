import { describe, expect, it } from 'vitest'
import { computeEligibleServices, initialMemberUnitIds, memberCommissionValue } from './member-form'

describe('memberCommissionValue', () => {
  it('formats a fixed commission as reais (cents/100, comma)', () => {
    expect(memberCommissionValue({ kind: 'fixed', value: 1500 })).toBe('15,00')
  })

  it('shows a percentage commission as the raw percent', () => {
    expect(memberCommissionValue({ kind: 'percentage', value: 12 })).toBe('12')
  })

  it('returns empty for none/undefined', () => {
    expect(memberCommissionValue(null)).toBe('')
    expect(memberCommissionValue(undefined)).toBe('')
  })
})

describe('initialMemberUnitIds', () => {
  it('keeps the professional stored units when present', () => {
    expect([...initialMemberUnitIds({ unitIds: ['u1', 'u2'] }, 'u9')]).toEqual(['u1', 'u2'])
  })

  it('pre-checks the active unit when the professional has no units yet', () => {
    expect([...initialMemberUnitIds({ unitIds: [] }, 'u9')]).toEqual(['u9'])
    expect([...initialMemberUnitIds(null, 'u9')]).toEqual(['u9'])
  })

  it('returns empty when there are no units and no active unit', () => {
    expect([...initialMemberUnitIds({ unitIds: [] }, null)]).toEqual([])
    expect([...initialMemberUnitIds(null, null)]).toEqual([])
  })
})

describe('computeEligibleServices', () => {
  const services = [
    { id: 's1', unitIds: ['u1'] },
    { id: 's2', unitIds: ['u2', 'u3'] },
    { id: 's3', unitIds: [] },
    { id: 's4' },
  ]

  it('keeps services offered in at least one selected unit', () => {
    expect(computeEligibleServices(services, new Set(['u1'])).map((s) => s.id)).toEqual(['s1'])
    expect(computeEligibleServices(services, new Set(['u2'])).map((s) => s.id)).toEqual(['s2'])
    expect(computeEligibleServices(services, new Set(['u1', 'u3'])).map((s) => s.id)).toEqual([
      's1',
      's2',
    ])
  })

  it('excludes services with empty/absent unitIds', () => {
    const r = computeEligibleServices(services, new Set(['u1', 'u2', 'u3']))
    expect(r.map((s) => s.id)).not.toContain('s3')
    expect(r.map((s) => s.id)).not.toContain('s4')
  })

  it('returns empty when no unit is selected', () => {
    expect(computeEligibleServices(services, new Set())).toEqual([])
  })
})
