import { describe, expect, it } from 'vitest'
import { DASHBOARD_PERIODS, DEFAULT_PERIOD, periodLabel, resolveDashboardFilters } from './filters'

const SP_TZ = 'America/Sao_Paulo'
const NOW = new Date('2026-03-15T15:00:00.000Z')

describe('resolveDashboardFilters', () => {
  it('defaults to 30d; unitId is always null (page resolves scope)', () => {
    const f = resolveDashboardFilters({}, SP_TZ, NOW)
    expect(f.period).toBe(DEFAULT_PERIOD)
    expect(f.unitId).toBeNull()
    expect(f.toDate).toBe('2026-03-15')
    expect(f.fromDate).toBe('2026-02-14')
  })

  it('today bounds in org tz', () => {
    const f = resolveDashboardFilters({ period: 'today' }, SP_TZ, NOW)
    expect(f.fromDate).toBe('2026-03-15')
    expect(f.toDate).toBe('2026-03-15')
    expect(f.fromUtc).toBe('2026-03-15T03:00:00.000Z')
    expect(f.toUtcExclusive).toBe('2026-03-16T03:00:00.000Z')
  })

  it('7d previous period is the prior 7 days', () => {
    const f = resolveDashboardFilters({ period: '7d' }, SP_TZ, NOW)
    expect(f.fromDate).toBe('2026-03-09')
    expect(f.toDate).toBe('2026-03-15')
    expect(f.previousFromDate).toBe('2026-03-02')
    expect(f.previousToDate).toBe('2026-03-08')
  })

  it('month uses calendar boundaries; previous = previous calendar month', () => {
    const f = resolveDashboardFilters({ period: 'month' }, SP_TZ, NOW)
    expect(f.fromDate).toBe('2026-03-01')
    expect(f.toDate).toBe('2026-03-15')
    expect(f.previousFromDate).toBe('2026-02-01')
    expect(f.previousToDate).toBe('2026-02-28')
  })

  it('custom range is honored when valid', () => {
    const f = resolveDashboardFilters(
      { period: 'custom', from: '2026-01-10', to: '2026-01-20' },
      SP_TZ,
      NOW,
    )
    expect(f.period).toBe('custom')
    expect(f.fromDate).toBe('2026-01-10')
    expect(f.toDate).toBe('2026-01-20')
    expect(f.previousFromDate).toBe('2025-12-30')
    expect(f.previousToDate).toBe('2026-01-09')
  })

  it('custom falls back to 30d when invalid or inverted', () => {
    const inverted = resolveDashboardFilters(
      { period: 'custom', from: '2026-01-20', to: '2026-01-10' },
      SP_TZ,
      NOW,
    )
    expect(inverted.period).toBe('30d')

    const missing = resolveDashboardFilters({ period: 'custom' }, SP_TZ, NOW)
    expect(missing.period).toBe('30d')
  })

  it('ignores unknown period values', () => {
    const f = resolveDashboardFilters({ period: 'forever' }, SP_TZ, NOW)
    expect(f.period).toBe(DEFAULT_PERIOD)
  })
})

describe('periodLabel', () => {
  it('returns a non-empty pt-BR label for every period', () => {
    for (const period of DASHBOARD_PERIODS) {
      expect(periodLabel(period).length).toBeGreaterThan(0)
    }
  })

  it('labels the known periods', () => {
    expect(periodLabel('today')).toBe('Hoje')
    expect(periodLabel('7d')).toBe('Últimos 7 dias')
    expect(periodLabel('30d')).toBe('Últimos 30 dias')
    expect(periodLabel('month')).toBe('Mês atual')
    expect(periodLabel('custom')).toBe('Personalizado')
  })
})
