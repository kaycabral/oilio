import { describe, expect, it } from 'vitest'
import { isOperational } from './enums'
import { professionalsForService, type Professional } from './professional'

describe('isOperational (#753 gate)', () => {
  it('only passes status="operational"', () => {
    expect(isOperational('operational')).toBe(true)
    expect(isOperational('incomplete')).toBe(false)
    expect(isOperational('incomplete')).toBe(false)
  })
})

function buildPro(overrides: Partial<Professional> = {}): Professional {
  return {
    id: 'p1',
    tenantId: 't1',
    userId: 'u-ana',
    name: 'Ana',
    whatsapp: '5511900000000',
    email: null,
    taxIdentity: null,
    operationalStatus: 'operational',
    defaultCommission: null,
    unitIds: ['u1'],
    serviceIds: ['s1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('professionalsForService (#876)', () => {
  it('returns empty when no professional executes the service', () => {
    expect(professionalsForService([buildPro({ serviceIds: ['s2'] })], 's1', 'u1')).toHaveLength(0)
  })

  it('returns only professionals at the given unit', () => {
    const a = buildPro({ id: 'a', name: 'Ana', unitIds: ['u1'], serviceIds: ['s1'] })
    const b = buildPro({ id: 'b', name: 'Bia', unitIds: ['u2'], serviceIds: ['s1'] })
    const list = professionalsForService([a, b], 's1', 'u1')
    expect(list.map((p) => p.id)).toEqual(['a'])
  })

  it('handles multiple services on a single pro', () => {
    const a = buildPro({ id: 'a', serviceIds: ['s1', 's2', 's3'], unitIds: ['u1'] })
    expect(professionalsForService([a], 's2', 'u1')).toHaveLength(1)
    expect(professionalsForService([a], 's4', 'u1')).toHaveLength(0)
  })

  it('multi-unit pro shows up at each of its units (for the same service)', () => {
    const a = buildPro({ id: 'a', unitIds: ['u1', 'u2'], serviceIds: ['s1'] })
    expect(professionalsForService([a], 's1', 'u1')).toHaveLength(1)
    expect(professionalsForService([a], 's1', 'u2')).toHaveLength(1)
    expect(professionalsForService([a], 's1', 'u3')).toHaveLength(0)
  })
})
