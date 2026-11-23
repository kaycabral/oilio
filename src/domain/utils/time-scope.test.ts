import { describe, expect, it } from 'vitest'
import {
  isAdvanceBookingAllowed,
  isDayOfWeekAllowed,
  isHourRangeAllowed,
  isInstantWithinTimeScope,
  isValidTimeScopeHHmm,
  mergeAllowedTimeScopes,
} from './time-scope'

const TZ = 'America/Sao_Paulo'

describe('isValidTimeScopeHHmm', () => {
  it('accepts valid HH:mm', () => {
    expect(isValidTimeScopeHHmm('00:00')).toBe(true)
    expect(isValidTimeScopeHHmm('08:30')).toBe(true)
    expect(isValidTimeScopeHHmm('23:59')).toBe(true)
  })
  it('rejects invalid HH:mm', () => {
    expect(isValidTimeScopeHHmm('24:00')).toBe(false)
    expect(isValidTimeScopeHHmm('8:00')).toBe(false)
    expect(isValidTimeScopeHHmm('08:60')).toBe(false)
    expect(isValidTimeScopeHHmm('foo')).toBe(false)
  })
})

describe('isDayOfWeekAllowed', () => {
  const wednesday = new Date('2025-11-19T12:00:00.000-03:00').toISOString()
  it('admits all when filter undefined', () => {
    expect(isDayOfWeekAllowed(undefined, wednesday, TZ)).toBe(true)
  })
  it('admits matching weekday', () => {
    expect(isDayOfWeekAllowed([1, 2, 3, 4, 5], wednesday, TZ)).toBe(true)
  })
  it('rejects non-matching weekday', () => {
    expect(isDayOfWeekAllowed([0, 6], wednesday, TZ)).toBe(false)
  })
})

describe('isHourRangeAllowed', () => {
  const tenAmLocal = new Date('2025-11-19T10:30:00.000-03:00').toISOString()
  const sevenPmLocal = new Date('2025-11-19T19:00:00.000-03:00').toISOString()
  it('admits all when undefined', () => {
    expect(isHourRangeAllowed(undefined, tenAmLocal, TZ)).toBe(true)
  })
  it('admits inside [start, end)', () => {
    expect(isHourRangeAllowed({ start: '08:00', end: '18:00' }, tenAmLocal, TZ)).toBe(true)
  })
  it('rejects at or after end (exclusive end)', () => {
    expect(isHourRangeAllowed({ start: '08:00', end: '18:00' }, sevenPmLocal, TZ)).toBe(false)
    expect(isHourRangeAllowed({ start: '08:00', end: '10:30' }, tenAmLocal, TZ)).toBe(false)
  })
  it('admits at start (inclusive start)', () => {
    expect(isHourRangeAllowed({ start: '10:30', end: '18:00' }, tenAmLocal, TZ)).toBe(true)
  })
})

describe('isAdvanceBookingAllowed', () => {
  it('admits all when undefined or 0', () => {
    expect(isAdvanceBookingAllowed(undefined, '2025-11-19', '2025-12-25')).toBe(true)
    expect(isAdvanceBookingAllowed(0, '2025-11-19', '2025-12-25')).toBe(true)
  })
  it('admits within window (inclusive)', () => {
    expect(isAdvanceBookingAllowed(3, '2025-11-19', '2025-11-19')).toBe(true)
    expect(isAdvanceBookingAllowed(3, '2025-11-19', '2025-11-22')).toBe(true)
  })
  it('rejects beyond window', () => {
    expect(isAdvanceBookingAllowed(3, '2025-11-19', '2025-11-23')).toBe(false)
  })
})

describe('isInstantWithinTimeScope', () => {
  const wedTenAm = new Date('2025-11-19T10:00:00.000-03:00').toISOString()
  it('null scope admits everything', () => {
    expect(isInstantWithinTimeScope(null, wedTenAm, TZ, '2025-11-19')).toBe(true)
  })
  it('all axes pass', () => {
    expect(
      isInstantWithinTimeScope(
        {
          daysOfWeek: [1, 2, 3, 4, 5],
          hourRange: { start: '08:00', end: '18:00' },
          advanceBookingDays: 3,
        },
        wedTenAm,
        TZ,
        '2025-11-19',
      ),
    ).toBe(true)
  })
  it('rejects when any axis fails', () => {
    expect(
      isInstantWithinTimeScope(
        { hourRange: { start: '14:00', end: '18:00' } },
        wedTenAm,
        TZ,
        '2025-11-19',
      ),
    ).toBe(false)
  })
})

describe('mergeAllowedTimeScopes', () => {
  it('returns null when both null', () => {
    expect(mergeAllowedTimeScopes(null, null)).toBeNull()
  })
  it('returns the only side when other null', () => {
    expect(mergeAllowedTimeScopes({ daysOfWeek: [1] }, null)).toEqual({ daysOfWeek: [1] })
  })
  it('unions daysOfWeek', () => {
    expect(mergeAllowedTimeScopes({ daysOfWeek: [1, 3] }, { daysOfWeek: [3, 5] })).toEqual({
      daysOfWeek: [1, 3, 5],
    })
  })
  it('widens hourRange to envelope', () => {
    expect(
      mergeAllowedTimeScopes(
        { hourRange: { start: '08:00', end: '12:00' } },
        { hourRange: { start: '10:00', end: '18:00' } },
      ),
    ).toEqual({ hourRange: { start: '08:00', end: '18:00' } })
  })
  it('takes max advanceBookingDays', () => {
    expect(mergeAllowedTimeScopes({ advanceBookingDays: 3 }, { advanceBookingDays: 7 })).toEqual({
      advanceBookingDays: 7,
    })
  })
  it('axis with one undefined collapses to unrestricted', () => {
    expect(
      mergeAllowedTimeScopes(
        { daysOfWeek: [1, 2, 3] },
        { hourRange: { start: '08:00', end: '18:00' } },
      ),
    ).toBeNull()
  })
})

describe('time-scope — edge cases (mutation)', () => {
  const utc = '2026-06-15T15:00:00.000Z'
  const weekday = new Date(Date.UTC(2026, 5, 15)).getUTCDay()

  it('isValidTimeScopeHHmm rejects out-of-range hour/minute and bad format', () => {
    expect(isValidTimeScopeHHmm('23:59')).toBe(true)
    expect(isValidTimeScopeHHmm('24:00')).toBe(false)
    expect(isValidTimeScopeHHmm('00:60')).toBe(false)
    expect(isValidTimeScopeHHmm('9:00')).toBe(false)
  })

  it('isDayOfWeekAllowed admits only the actual local weekday', () => {
    expect(isDayOfWeekAllowed([weekday], utc, TZ)).toBe(true)
    expect(isDayOfWeekAllowed([(weekday + 1) % 7], utc, TZ)).toBe(false)
    expect(isDayOfWeekAllowed([], utc, TZ)).toBe(true)
    expect(isDayOfWeekAllowed(undefined, utc, TZ)).toBe(true)
  })

  it('isHourRangeAllowed is start-inclusive, end-exclusive, rejects degenerate', () => {
    expect(isHourRangeAllowed({ start: '12:00', end: '13:00' }, utc, TZ)).toBe(true)
    expect(isHourRangeAllowed({ start: '11:00', end: '12:00' }, utc, TZ)).toBe(false)
    expect(isHourRangeAllowed({ start: '13:00', end: '14:00' }, utc, TZ)).toBe(false)
    expect(isHourRangeAllowed({ start: '13:00', end: '12:00' }, utc, TZ)).toBe(false)
    expect(isHourRangeAllowed(undefined, utc, TZ)).toBe(true)
  })

  it('isAdvanceBookingAllowed window is inclusive at the boundary', () => {
    expect(isAdvanceBookingAllowed(7, '2026-06-10', '2026-06-17')).toBe(true)
    expect(isAdvanceBookingAllowed(7, '2026-06-10', '2026-06-18')).toBe(false)
    expect(isAdvanceBookingAllowed(0, '2026-06-10', '2026-12-31')).toBe(true)
    expect(isAdvanceBookingAllowed(undefined, '2026-06-10', '2026-12-31')).toBe(true)
  })

  it('isInstantWithinTimeScope: every axis can independently reject', () => {
    expect(isInstantWithinTimeScope(null, utc, TZ, '2026-06-15')).toBe(true)
    expect(
      isInstantWithinTimeScope({ daysOfWeek: [(weekday + 1) % 7] }, utc, TZ, '2026-06-15'),
    ).toBe(false)
    expect(
      isInstantWithinTimeScope(
        { hourRange: { start: '13:00', end: '14:00' } },
        utc,
        TZ,
        '2026-06-15',
      ),
    ).toBe(false)
    expect(isInstantWithinTimeScope({ advanceBookingDays: 1 }, utc, TZ, '2026-06-10')).toBe(false)
    expect(
      isInstantWithinTimeScope(
        {
          daysOfWeek: [weekday],
          hourRange: { start: '12:00', end: '13:00' },
          advanceBookingDays: 30,
        },
        utc,
        TZ,
        '2026-06-15',
      ),
    ).toBe(true)
  })

  it('mergeAllowedTimeScopes: collapse + most-permissive union', () => {
    expect(mergeAllowedTimeScopes(null, null)).toBeNull()
    expect(mergeAllowedTimeScopes({ daysOfWeek: [1] }, null)).toEqual({ daysOfWeek: [1] })
    expect(mergeAllowedTimeScopes(null, { daysOfWeek: [2] })).toEqual({ daysOfWeek: [2] })
    expect(mergeAllowedTimeScopes({ daysOfWeek: [1, 2] }, { daysOfWeek: [2, 3] })).toEqual({
      daysOfWeek: [1, 2, 3],
    })
    expect(
      mergeAllowedTimeScopes({ daysOfWeek: [1] }, { hourRange: { start: '09:00', end: '12:00' } }),
    ).toBeNull()
    expect(
      mergeAllowedTimeScopes(
        { daysOfWeek: [1], hourRange: { start: '10:00', end: '12:00' } },
        { daysOfWeek: [2], hourRange: { start: '09:00', end: '14:00' } },
      ),
    ).toEqual({ daysOfWeek: [1, 2], hourRange: { start: '09:00', end: '14:00' } })
    expect(
      mergeAllowedTimeScopes({ daysOfWeek: [0, 1, 2, 3] }, { daysOfWeek: [4, 5, 6] }),
    ).toBeNull()
    expect(
      mergeAllowedTimeScopes(
        { hourRange: { start: '10:00', end: '12:00' } },
        { hourRange: { start: '09:00', end: '14:00' } },
      ),
    ).toEqual({ hourRange: { start: '09:00', end: '14:00' } })
    expect(mergeAllowedTimeScopes({ advanceBookingDays: 7 }, { advanceBookingDays: 30 })).toEqual({
      advanceBookingDays: 30,
    })
    expect(mergeAllowedTimeScopes({ daysOfWeek: [1] }, { advanceBookingDays: 5 })).toBeNull()
  })
})
