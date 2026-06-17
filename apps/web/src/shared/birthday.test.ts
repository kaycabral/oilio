import { describe, expect, it } from 'vitest'

import { isBirthdayToday } from './birthday'

const JUN_15 = new Date('2026-06-15T10:00:00').getTime()

describe('isBirthdayToday', () => {
  it('matches the same month and day regardless of year', () => {
    expect(isBirthdayToday('1990-06-15', JUN_15)).toBe(true)
    expect(isBirthdayToday('2001-06-15', JUN_15)).toBe(true)
  })

  it('is false on any other day or for malformed input', () => {
    expect(isBirthdayToday('1990-06-14', JUN_15)).toBe(false)
    expect(isBirthdayToday('1990-05-15', JUN_15)).toBe(false)
    expect(isBirthdayToday('', JUN_15)).toBe(false)
    expect(isBirthdayToday('15/06', JUN_15)).toBe(false)
  })
})
