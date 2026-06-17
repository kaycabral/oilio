import { describe, expect, it } from 'vitest'
import { formatBirthDate, parseBirthDate } from './customer'

describe('parseBirthDate', () => {
  const today = new Date(2026, 4, 16)

  it('accepts empty input as null (field is optional)', () => {
    expect(parseBirthDate('', today)).toEqual({ ok: true, value: null })
    expect(parseBirthDate('   ', today)).toEqual({ ok: true, value: null })
  })

  it('accepts a valid past date', () => {
    expect(parseBirthDate('1990-05-16', today)).toEqual({ ok: true, value: '1990-05-16' })
  })

  it('accepts today', () => {
    expect(parseBirthDate('2026-05-16', today)).toEqual({ ok: true, value: '2026-05-16' })
  })

  it('rejects future dates', () => {
    const result = parseBirthDate('2026-05-17', today)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/futuro/i)
  })

  it('rejects malformed strings with the exact message', () => {
    expect(parseBirthDate('16/05/1990', today)).toEqual({
      ok: false,
      error: 'Data de nascimento inválida',
    })
    expect(parseBirthDate('1990-5-16', today).ok).toBe(false)
    expect(parseBirthDate('not a date', today).ok).toBe(false)
  })

  it('rejects a value with a trailing suffix (end anchor)', () => {
    // The first 10 chars are a valid date; only the `$` anchor rejects this.
    expect(parseBirthDate('1990-05-16-99', today).ok).toBe(false)
  })

  it('rejects calendar-invalid dates with the exact message (e.g. Feb 30)', () => {
    expect(parseBirthDate('2025-02-30', today)).toEqual({
      ok: false,
      error: 'Data de nascimento inválida',
    })
    expect(parseBirthDate('2025-13-01', today).ok).toBe(false)
    expect(parseBirthDate('2025-00-10', today).ok).toBe(false)
    expect(parseBirthDate('2025-01-32', today).ok).toBe(false)
  })

  it('accepts exactly 1900-01-01 (lower boundary is inclusive)', () => {
    expect(parseBirthDate('1900-01-01', today)).toEqual({ ok: true, value: '1900-01-01' })
  })

  it('rejects years before 1900 with the exact message', () => {
    expect(parseBirthDate('1899-12-31', today)).toEqual({
      ok: false,
      error: 'Ano de nascimento muito antigo',
    })
  })

  it('rejects future dates with the exact message', () => {
    expect(parseBirthDate('2026-05-17', today)).toEqual({
      ok: false,
      error: 'Data de nascimento não pode ser no futuro',
    })
  })

  it('zero-pads single-digit today month/day when comparing (no off-by-padding)', () => {
    // 2026-01-05: without padStart, todayIso would be "2026-1-5" and the
    // string comparison would mis-rank these boundary cases.
    const earlyToday = new Date(2026, 0, 5)
    expect(parseBirthDate('2026-01-05', earlyToday)).toEqual({ ok: true, value: '2026-01-05' })
    expect(parseBirthDate('2026-01-06', earlyToday).ok).toBe(false)
  })
})

describe('formatBirthDate', () => {
  it('formats ISO date as DD/MM/YYYY', () => {
    expect(formatBirthDate('1990-05-16')).toBe('16/05/1990')
  })

  it('returns dash for null', () => {
    expect(formatBirthDate(null)).toBe('—')
  })

  it('returns dash for malformed input', () => {
    expect(formatBirthDate('not-a-date')).toBe('—')
  })

  it('returns dash when the date is not the whole string (both anchors)', () => {
    expect(formatBirthDate('x1990-05-16')).toBe('—')
    expect(formatBirthDate('1990-05-16-99')).toBe('—')
  })
})
