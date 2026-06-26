import { describe, expect, it } from 'vitest'
import { defaultFirstUnitHours } from './unit-defaults'

describe('defaultFirstUnitHours', () => {
  it('opens Monday–Saturday 09:00–18:00 and closes Sunday', () => {
    const hours = defaultFirstUnitHours()
    for (const day of [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ] as const) {
      expect(hours[day]).toEqual([{ open: '09:00', close: '18:00' }])
    }
    expect(hours.sunday).toBeNull()
  })

  it('returns a fresh object each call (no shared mutable reference)', () => {
    const a = defaultFirstUnitHours()
    const b = defaultFirstUnitHours()
    expect(a).not.toBe(b)
    expect(a.monday).not.toBe(b.monday)
  })
})
