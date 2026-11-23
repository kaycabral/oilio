import { describe, expect, it } from 'vitest'
import { isBookingLimitsUnrestricted, mergeBookingLimits } from './booking-limits'

describe('isBookingLimitsUnrestricted', () => {
  it('treats null/undefined as unrestricted', () => {
    expect(isBookingLimitsUnrestricted(null)).toBe(true)
    expect(isBookingLimitsUnrestricted(undefined)).toBe(true)
    expect(isBookingLimitsUnrestricted({})).toBe(true)
  })
  it('false requireCompleteBeforeNext does not count as a restriction', () => {
    expect(isBookingLimitsUnrestricted({ requireCompleteBeforeNext: false })).toBe(true)
  })
  it('any active sub-field counts as restriction', () => {
    expect(isBookingLimitsUnrestricted({ maxPerDay: 1 })).toBe(false)
    expect(isBookingLimitsUnrestricted({ maxConcurrent: 2 })).toBe(false)
    expect(isBookingLimitsUnrestricted({ requireCompleteBeforeNext: true })).toBe(false)
  })
})

describe('mergeBookingLimits', () => {
  it('returns null when both null', () => {
    expect(mergeBookingLimits(null, null)).toBeNull()
  })
  it('returns the only side when other null', () => {
    expect(mergeBookingLimits({ maxPerDay: 2 }, null)).toEqual({ maxPerDay: 2 })
  })
  it('picks max of maxPerDay', () => {
    expect(mergeBookingLimits({ maxPerDay: 1 }, { maxPerDay: 3 })).toEqual({ maxPerDay: 3 })
  })
  it('picks max of maxConcurrent', () => {
    expect(mergeBookingLimits({ maxConcurrent: 2 }, { maxConcurrent: 5 })).toEqual({
      maxConcurrent: 5,
    })
  })
  it('axis with one undefined collapses to unrestricted', () => {
    expect(mergeBookingLimits({ maxPerDay: 1 }, { maxConcurrent: 5 })).toBeNull()
  })
  it('requireCompleteBeforeNext stays true only when both true', () => {
    expect(
      mergeBookingLimits({ requireCompleteBeforeNext: true }, { requireCompleteBeforeNext: true }),
    ).toEqual({ requireCompleteBeforeNext: true })
  })
  it('any false in requireCompleteBeforeNext collapses to dropped (most permissive)', () => {
    expect(
      mergeBookingLimits({ requireCompleteBeforeNext: true }, { requireCompleteBeforeNext: false }),
    ).toBeNull()
  })
})
