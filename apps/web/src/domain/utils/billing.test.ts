import { describe, expect, it } from 'vitest'
import {
  addMonthsUtc,
  computeBillingPeriod,
  computeNextChargeDate,
  isUsageLimitReached,
  remainingUsage,
} from './billing'

describe('addMonthsUtc', () => {
  it('adds one month preserving day and hour', () => {
    expect(addMonthsUtc('2026-01-15T03:30:00.000Z', 1)).toBe('2026-02-15T03:30:00.000Z')
  })

  it('clamps to last day of month when target month is shorter', () => {
    // 31 jan + 1 mês cai em 28 fev (2026 não é bissexto).
    expect(addMonthsUtc('2026-01-31T12:00:00.000Z', 1)).toBe('2026-02-28T12:00:00.000Z')
  })

  it('handles leap years', () => {
    // 31 jan 2028 (ano bissexto) + 1 mês → 29 fev 2028.
    expect(addMonthsUtc('2028-01-31T12:00:00.000Z', 1)).toBe('2028-02-29T12:00:00.000Z')
  })

  it('crosses year boundaries', () => {
    expect(addMonthsUtc('2026-11-15T12:00:00.000Z', 3)).toBe('2027-02-15T12:00:00.000Z')
  })

  it('adds 12 months for annual cycle', () => {
    expect(addMonthsUtc('2026-05-14T00:00:00.000Z', 12)).toBe('2027-05-14T00:00:00.000Z')
  })
})

describe('computeBillingPeriod', () => {
  it('monthly', () => {
    expect(computeBillingPeriod('2026-05-01T00:00:00.000Z', 'monthly')).toEqual({
      startAt: '2026-05-01T00:00:00.000Z',
      endAt: '2026-06-01T00:00:00.000Z',
    })
  })

  it('quarterly', () => {
    expect(computeBillingPeriod('2026-01-15T00:00:00.000Z', 'quarterly')).toEqual({
      startAt: '2026-01-15T00:00:00.000Z',
      endAt: '2026-04-15T00:00:00.000Z',
    })
  })

  it('semiannual', () => {
    expect(computeBillingPeriod('2026-03-01T00:00:00.000Z', 'semiannual')).toEqual({
      startAt: '2026-03-01T00:00:00.000Z',
      endAt: '2026-09-01T00:00:00.000Z',
    })
  })

  it('annual', () => {
    expect(computeBillingPeriod('2026-01-01T00:00:00.000Z', 'annual')).toEqual({
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2027-01-01T00:00:00.000Z',
    })
  })
})

describe('computeNextChargeDate', () => {
  it('returns the period end (next cycle start)', () => {
    expect(computeNextChargeDate('2026-06-01T00:00:00.000Z')).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('isUsageLimitReached', () => {
  it('unlimited never reaches limit', () => {
    expect(isUsageLimitReached(9999, { kind: 'unlimited' })).toBe(false)
  })

  it('count: below quantity → false', () => {
    expect(isUsageLimitReached(3, { kind: 'count', quantity: 4 })).toBe(false)
  })

  it('count: at quantity → true', () => {
    expect(isUsageLimitReached(4, { kind: 'count', quantity: 4 })).toBe(true)
  })

  it('count: above quantity → true (defensive)', () => {
    expect(isUsageLimitReached(5, { kind: 'count', quantity: 4 })).toBe(true)
  })
})

describe('remainingUsage', () => {
  it('unlimited → null', () => {
    expect(remainingUsage(3, { kind: 'unlimited' })).toBeNull()
  })

  it('count: returns quantity - consumed', () => {
    expect(remainingUsage(1, { kind: 'count', quantity: 4 })).toBe(3)
  })

  it('count: clamps to 0 when consumed exceeds quantity', () => {
    expect(remainingUsage(7, { kind: 'count', quantity: 4 })).toBe(0)
  })
})
