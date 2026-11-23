import { describe, expect, it } from 'vitest'

import { formatRelativeDate } from './relative-date'

const NOW = new Date('2026-06-15T12:00:00').getTime()

describe('formatRelativeDate', () => {
  it('renders same-day distances as relative hours/minutes', () => {
    expect(formatRelativeDate('2026-06-15T12:00:30', NOW)).toBe('agora')
    expect(formatRelativeDate('2026-06-15T11:45:00', NOW)).toBe('há 15min')
    expect(formatRelativeDate('2026-06-15T10:00:00', NOW)).toBe('há 2h')
    expect(formatRelativeDate('2026-06-15T15:30:00', NOW)).toBe('em 3h')
  })

  it('renders yesterday/tomorrow in words', () => {
    expect(formatRelativeDate('2026-06-14T20:00:00', NOW)).toBe('ontem')
    expect(formatRelativeDate('2026-06-16T08:00:00', NOW)).toBe('amanhã')
  })

  it('keeps near FUTURE relative within the window', () => {
    expect(formatRelativeDate('2026-06-21T08:00:00', NOW)).toBe('em 6 dias')
  })

  it('uses a short date for past beyond yesterday and far future', () => {
    expect(formatRelativeDate('2026-06-10T08:00:00', NOW)).toBe('10/06/26')
    expect(formatRelativeDate('2026-07-14T08:00:00', NOW)).toBe('14/07/26')
  })
})
