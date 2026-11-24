import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './format'

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-01T12:00:00.000Z').getTime()

  it('returns "agora" for < 1 minute', () => {
    expect(formatRelativeTime('2026-06-01T11:59:30.000Z', now)).toBe('agora')
  })

  it('returns minutes for < 1 hour', () => {
    expect(formatRelativeTime('2026-06-01T11:30:00.000Z', now)).toBe('há 30min')
    expect(formatRelativeTime('2026-06-01T11:01:00.000Z', now)).toBe('há 59min')
  })

  it('returns hours for < 1 day', () => {
    expect(formatRelativeTime('2026-06-01T10:00:00.000Z', now)).toBe('há 2h')
    expect(formatRelativeTime('2026-05-31T13:00:00.000Z', now)).toBe('há 23h')
  })

  it('returns days for >= 1 day', () => {
    expect(formatRelativeTime('2026-05-30T12:00:00.000Z', now)).toBe('há 2d')
    expect(formatRelativeTime('2026-05-25T12:00:00.000Z', now)).toBe('há 7d')
  })

  it('boundary: exactly 60 minutes → 1h', () => {
    expect(formatRelativeTime('2026-06-01T11:00:00.000Z', now)).toBe('há 1h')
  })

  it('boundary: exactly 24 hours → 1d', () => {
    expect(formatRelativeTime('2026-05-31T12:00:00.000Z', now)).toBe('há 1d')
  })
})
