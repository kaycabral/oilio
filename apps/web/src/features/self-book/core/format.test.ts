import { describe, expect, it } from 'vitest'
import { formatDuration, formatNoticeWindow } from './format'

describe('formatDuration', () => {
  it('keeps sub-hour in minutes', () => {
    expect(formatDuration(30)).toBe('30 min')
  })

  it('renders whole hours without minutes', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
  })

  it('pads the minute remainder', () => {
    expect(formatDuration(90)).toBe('1h30')
    expect(formatDuration(65)).toBe('1h05')
  })
})

describe('formatNoticeWindow', () => {
  it('returns minutes for sub-hour and non-round windows', () => {
    expect(formatNoticeWindow(45)).toBe('45 minutos')
    expect(formatNoticeWindow(90)).toBe('90 minutos')
  })

  it('returns hours, singular at 1', () => {
    expect(formatNoticeWindow(60)).toBe('1 hora')
    expect(formatNoticeWindow(120)).toBe('2 horas')
  })

  it('returns days when whole, singular at 1', () => {
    expect(formatNoticeWindow(60 * 24)).toBe('1 dia')
    expect(formatNoticeWindow(60 * 24 * 2)).toBe('2 dias')
  })

  it('clamps non-positive to 0 minutos', () => {
    expect(formatNoticeWindow(0)).toBe('0 minutos')
    expect(formatNoticeWindow(-10)).toBe('0 minutos')
  })
})
