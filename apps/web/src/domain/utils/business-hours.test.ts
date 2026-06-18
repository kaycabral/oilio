import { describe, expect, it } from 'vitest'
import type { BusinessHours } from '../types/unit'
import {
  getBusinessHoursForDay,
  getWeekdayInOrgTz,
  hhmmToMinutes,
  isBusinessHoursConfigured,
  isValidHHmm,
  minutesToHHmm,
  validateHoursRange,
} from './business-hours'

const BR = 'America/Sao_Paulo'

const FULL_WEEK: BusinessHours = {
  monday: { open: '08:00', close: '18:00' },
  tuesday: { open: '08:00', close: '18:00' },
  wednesday: { open: '08:00', close: '18:00' },
  thursday: { open: '08:00', close: '18:00' },
  friday: { open: '08:00', close: '20:00' },
  saturday: { open: '09:00', close: '14:00' },
  sunday: null,
}

describe('hhmmToMinutes / minutesToHHmm', () => {
  it('converts both directions', () => {
    expect(hhmmToMinutes('00:00')).toBe(0)
    expect(hhmmToMinutes('08:30')).toBe(510)
    expect(hhmmToMinutes('23:59')).toBe(23 * 60 + 59)
    expect(minutesToHHmm(0)).toBe('00:00')
    expect(minutesToHHmm(510)).toBe('08:30')
  })

  it('throws on malformed input, with the offending value in the message', () => {
    expect(() => hhmmToMinutes('8:30')).toThrow('Invalid HH:mm: 8:30')
    expect(() => hhmmToMinutes('24:00')).toThrow('Invalid HH:mm: 24:00')
    expect(() => hhmmToMinutes('12:60')).toThrow('Invalid HH:mm: 12:60')
  })
})

describe('isValidHHmm', () => {
  it('accepts 00:00..23:59', () => {
    expect(isValidHHmm('00:00')).toBe(true)
    expect(isValidHHmm('23:59')).toBe(true)
  })

  it('rejects malformed and out-of-range', () => {
    expect(isValidHHmm('24:00')).toBe(false)
    expect(isValidHHmm('12:60')).toBe(false)
    expect(isValidHHmm('8:30')).toBe(false)
    expect(isValidHHmm('')).toBe(false)
  })

  it('anchors the match to the whole string (no leading/trailing garbage)', () => {
    expect(isValidHHmm('x12:34')).toBe(false)
    expect(isValidHHmm('12:345')).toBe(false)
  })
})

describe('validateHoursRange', () => {
  it('passes on valid ranges', () => {
    expect(validateHoursRange({ open: '08:00', close: '18:00' })).toBeNull()
  })

  it('rejects close <= open with the exact message', () => {
    expect(validateHoursRange({ open: '18:00', close: '08:00' })).toBe(
      'Abertura deve ser antes do fechamento',
    )
    expect(validateHoursRange({ open: '12:00', close: '12:00' })).toBe(
      'Abertura deve ser antes do fechamento',
    )
  })

  it('rejects a malformed open time with the exact message', () => {
    expect(validateHoursRange({ open: '24:00', close: '18:00' })).toBe(
      'Horário de abertura inválido',
    )
  })

  it('rejects a malformed close time with the exact message', () => {
    expect(validateHoursRange({ open: '08:00', close: '24:00' })).toBe(
      'Horário de fechamento inválido',
    )
  })
})

describe('isBusinessHoursConfigured', () => {
  it('is false when null', () => {
    expect(isBusinessHoursConfigured(null)).toBe(false)
  })
  it('is true when at least one weekday has a range', () => {
    expect(isBusinessHoursConfigured(FULL_WEEK)).toBe(true)
  })
  // v2: the agenda always carries a businessHours object — an all-closed week
  // (the EMPTY_BUSINESS_HOURS zero-value) means "not configured", NOT a present
  // map. Guards the off-hours banner + publish readiness for a fresh unit.
  it('is false for an all-closed week (every day null)', () => {
    const allClosed: BusinessHours = {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    }
    expect(isBusinessHoursConfigured(allClosed)).toBe(false)
  })
})

describe('getWeekdayInOrgTz', () => {
  it('returns BR weekday for known dates', () => {
    // 2026-05-14 is a Thursday
    expect(getWeekdayInOrgTz('2026-05-14', BR)).toBe('thursday')
    // 2026-05-17 is a Sunday
    expect(getWeekdayInOrgTz('2026-05-17', BR)).toBe('sunday')
  })

  it('returns same weekday in UTC for same calendar date', () => {
    expect(getWeekdayInOrgTz('2026-05-14', 'UTC')).toBe('thursday')
  })
})

describe('getBusinessHoursForDay', () => {
  it('returns the day-of-week ranges as a flat list', () => {
    expect(getBusinessHoursForDay(FULL_WEEK, '2026-05-15', BR)).toEqual([
      { open: '08:00', close: '20:00' },
    ])
  })

  it('returns an empty list for a closed weekday', () => {
    expect(getBusinessHoursForDay(FULL_WEEK, '2026-05-17', BR)).toEqual([])
  })

  it('returns an empty list when businessHours is null (not configured)', () => {
    expect(getBusinessHoursForDay(null, '2026-05-14', BR)).toEqual([])
  })
})
