import { describe, expect, it } from 'vitest'
import { parseOrgLocalAsUtc, tzOffsetAt } from './datetime'

describe('parseOrgLocalAsUtc', () => {
  it('reads wall-clock digits as São Paulo local time (UTC-3)', () => {
    // 2026-03-10 is outside Brazil DST (abolished 2019) → fixed -03:00.
    const utc = parseOrgLocalAsUtc('2026-03-10T09:00', 'America/Sao_Paulo')
    expect(utc.toISOString()).toBe('2026-03-10T12:00:00.000Z')
  })

  it('treats a UTC timezone as identity', () => {
    const utc = parseOrgLocalAsUtc('2026-03-10T09:00', 'UTC')
    expect(utc.toISOString()).toBe('2026-03-10T09:00:00.000Z')
  })

  it('handles a positive-offset zone (Asia/Tokyo, UTC+9)', () => {
    const utc = parseOrgLocalAsUtc('2026-03-10T09:00', 'Asia/Tokyo')
    expect(utc.toISOString()).toBe('2026-03-10T00:00:00.000Z')
  })

  it('throws on malformed input', () => {
    expect(() => parseOrgLocalAsUtc('not-a-date', 'UTC')).toThrow()
    expect(() => parseOrgLocalAsUtc('2026-03-10 09:00', 'UTC')).toThrow()
  })
})

describe('tzOffsetAt', () => {
  it('returns -3h for São Paulo (ms)', () => {
    const ms = Date.UTC(2026, 2, 10, 12, 0)
    expect(tzOffsetAt(ms, 'America/Sao_Paulo')).toBe(-3 * 60 * 60 * 1000)
  })

  it('returns zero for UTC', () => {
    expect(tzOffsetAt(Date.UTC(2026, 2, 10, 12, 0), 'UTC')).toBe(0)
  })
})
