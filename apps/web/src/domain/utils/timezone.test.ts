import { describe, expect, it } from 'vitest'
import {
  assertValidTimezone,
  fromOrgTime,
  getOrgDayBoundsUtc,
  getTodayInOrgTz,
  isValidTimezone,
  toOrgTime,
} from './timezone'

const BR = 'America/Sao_Paulo'

describe('toOrgTime', () => {
  it('shifts a UTC instant into BR wall-clock time', () => {
    // 2026-05-14T12:00:00Z → 09:00 BR
    expect(toOrgTime('2026-05-14T12:00:00.000Z', BR)).toEqual({
      dateISO: '2026-05-14',
      hour: 9,
      minute: 0,
    })
  })

  it('keeps a UTC instant unchanged in UTC', () => {
    expect(toOrgTime('2026-05-14T12:34:00.000Z', 'UTC')).toEqual({
      dateISO: '2026-05-14',
      hour: 12,
      minute: 34,
    })
  })

  it('rolls back to the previous day when UTC instant is early-morning UTC but late-night local', () => {
    // 2026-05-15T02:30:00Z → 2026-05-14 23:30 BR (UTC-3)
    expect(toOrgTime('2026-05-15T02:30:00.000Z', BR)).toEqual({
      dateISO: '2026-05-14',
      hour: 23,
      minute: 30,
    })
  })

  it('handles DST transitions in zones that observe it (America/New_York)', () => {
    // 2026-03-08T07:00:00Z is right after EST→EDT spring-forward in 2026.
    // 02:00 EST became 03:00 EDT, so 07:00 UTC = 03:00 EDT (-4).
    const ny = toOrgTime('2026-03-08T07:00:00.000Z', 'America/New_York')
    expect(ny.dateISO).toBe('2026-03-08')
    expect(ny.hour).toBe(3)
  })

  it('throws on invalid UTC ISO', () => {
    expect(() => toOrgTime('not-a-date', BR)).toThrow(/Invalid UTC ISO/)
  })
})

describe('fromOrgTime', () => {
  it('rounds-trips with toOrgTime in BR', () => {
    const utc = fromOrgTime({ date: '2026-05-14', hour: 9, minute: 0 }, BR)
    expect(utc).toBe('2026-05-14T12:00:00.000Z')
    expect(toOrgTime(utc, BR)).toEqual({ dateISO: '2026-05-14', hour: 9, minute: 0 })
  })

  it('handles late-night BR crossing UTC day boundary', () => {
    const utc = fromOrgTime({ date: '2026-05-14', hour: 23, minute: 30 }, BR)
    expect(utc).toBe('2026-05-15T02:30:00.000Z')
  })

  it('round-trips across a spring-forward DST transition (America/New_York)', () => {
    // 2026-03-08, EDT begins. 03:30 EDT = 07:30 UTC.
    const utc = fromOrgTime({ date: '2026-03-08', hour: 3, minute: 30 }, 'America/New_York')
    expect(utc).toBe('2026-03-08T07:30:00.000Z')
    expect(toOrgTime(utc, 'America/New_York')).toEqual({
      dateISO: '2026-03-08',
      hour: 3,
      minute: 30,
    })
  })

  it('throws on malformed date', () => {
    expect(() => fromOrgTime({ date: '14/05/2026', hour: 9, minute: 0 }, BR)).toThrow(
      /Invalid date/,
    )
  })
})

describe('getTodayInOrgTz', () => {
  it('returns the BR local date even when UTC is on the next day', () => {
    // 2026-05-15 02:30 UTC = 2026-05-14 23:30 BR
    const now = new Date('2026-05-15T02:30:00.000Z')
    expect(getTodayInOrgTz(BR, now)).toBe('2026-05-14')
  })

  it('returns the UTC date in UTC tz', () => {
    const now = new Date('2026-05-15T02:30:00.000Z')
    expect(getTodayInOrgTz('UTC', now)).toBe('2026-05-15')
  })
})

describe('getOrgDayBoundsUtc', () => {
  it('returns BR day bounds shifted +3h into UTC', () => {
    // 2026-05-14 00:00 BR = 2026-05-14 03:00 UTC
    // 2026-05-15 00:00 BR = 2026-05-15 03:00 UTC, minus 1ms
    expect(getOrgDayBoundsUtc('2026-05-14', BR)).toEqual({
      startUtc: '2026-05-14T03:00:00.000Z',
      endUtc: '2026-05-15T02:59:59.999Z',
    })
  })

  it('captures an appointment booked at 23:30 BR even though UTC is already the next day', () => {
    // Appointment at 23:30 BR on 2026-05-14 → 02:30 UTC on 2026-05-15.
    const { startUtc, endUtc } = getOrgDayBoundsUtc('2026-05-14', BR)
    const appt = '2026-05-15T02:30:00.000Z'
    expect(appt >= startUtc && appt <= endUtc).toBe(true)
  })

  it('day length under DST spring-forward is 23 hours', () => {
    // America/New_York gains 1h on 2026-03-08 → bounds span 23h.
    const { startUtc, endUtc } = getOrgDayBoundsUtc('2026-03-08', 'America/New_York')
    const ms = new Date(endUtc).getTime() - new Date(startUtc).getTime() + 1
    expect(ms).toBe(23 * 60 * 60 * 1000)
  })
})

describe('isValidTimezone / assertValidTimezone', () => {
  it('accepts known IANA zones', () => {
    expect(isValidTimezone(BR)).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
  })

  it('rejects malformed strings', () => {
    expect(isValidTimezone('Not/A_Zone')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })

  it('assertValidTimezone throws on invalid input', () => {
    expect(() => assertValidTimezone('Not/A_Zone')).toThrow(/Invalid IANA timezone/)
  })
})
