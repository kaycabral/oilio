import { describe, expect, it } from 'vitest'
import { VERTICALS } from './enums'
import { VERTICAL_DEFAULTS } from './vertical-defaults'

describe('VERTICAL_DEFAULTS', () => {
  it('exposes every Vertical key in VERTICALS', () => {
    for (const v of VERTICALS) {
      expect(VERTICAL_DEFAULTS[v]).toBeDefined()
    }
    expect(Object.keys(VERTICAL_DEFAULTS).sort()).toEqual([...VERTICALS].sort())
  })

  it('uses a valid SlotMinutes default per vertical', () => {
    const valid = new Set([5, 10, 15, 20, 30, 60])
    for (const v of VERTICALS) {
      expect(valid.has(VERTICAL_DEFAULTS[v].defaultSlotMinutes)).toBe(true)
    }
  })

  it('keeps suggested services internally consistent', () => {
    for (const v of VERTICALS) {
      const { suggestedServices } = VERTICAL_DEFAULTS[v]
      for (const s of suggestedServices) {
        expect(s.name.length).toBeGreaterThan(0)
        expect(s.category.length).toBeGreaterThan(0)
        expect(s.durationMinutes).toBeGreaterThan(0)
        expect(s.durationMinutes).toBeLessThanOrEqual(24 * 60)
        expect(s.priceCents).toBeGreaterThanOrEqual(0)
      }
      const names = suggestedServices.map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('has zero suggested services for `other` (intentional)', () => {
    expect(VERTICAL_DEFAULTS.other.suggestedServices).toEqual([])
  })
})
