import { describe, expect, it } from 'vitest'
import { computeNoticeMinutes } from './appointment'

describe('computeNoticeMinutes', () => {
  it('returns whole minutes between scheduledStartAt and actionAt', () => {
    expect(computeNoticeMinutes('2026-06-01T12:00:00.000Z', '2026-06-01T10:00:00.000Z')).toBe(120)
  })

  it('returns 0 when the action happens exactly at the scheduled start', () => {
    expect(computeNoticeMinutes('2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z')).toBe(0)
  })

  it('returns negative when the action happens after the scheduled start', () => {
    expect(computeNoticeMinutes('2026-06-01T12:00:00.000Z', '2026-06-01T13:30:00.000Z')).toBe(-90)
  })

  it('floors fractional minutes', () => {
    expect(computeNoticeMinutes('2026-06-01T12:01:00.000Z', '2026-06-01T12:00:30.000Z')).toBe(0)
  })

  it('survives DST transitions (UTC math is invariant)', () => {
    // 2026-03-08 02:00 America/New_York skips to 03:00. UTC math doesn't care.
    expect(computeNoticeMinutes('2026-03-08T08:00:00.000Z', '2026-03-08T06:00:00.000Z')).toBe(120)
  })
})
