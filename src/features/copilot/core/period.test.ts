import { describe, expect, it } from 'vitest'
import { currentPeriod, formatPeriodLabel } from './period'

describe('currentPeriod', () => {
  it('formats YYYY-MM in the org timezone', () => {
    expect(currentPeriod('America/Sao_Paulo', new Date('2026-06-10T12:00:00Z'))).toBe('2026-06')
  })

  it('resolves the period by the org timezone, not UTC', () => {
    expect(currentPeriod('America/Sao_Paulo', new Date('2026-07-01T01:00:00Z'))).toBe('2026-06')
  })
})

describe('formatPeriodLabel', () => {
  it('renders a pt-BR month label', () => {
    expect(formatPeriodLabel('2026-06')).toBe('junho de 2026')
  })

  it('returns the raw string on malformed input', () => {
    expect(formatPeriodLabel('nope')).toBe('nope')
  })
})
