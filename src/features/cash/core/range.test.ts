import { describe, expect, it } from 'vitest'
import { resolveCashReportRange } from './range'

const TZ = 'America/Sao_Paulo'
const NOW = new Date('2026-05-15T18:30:00.000Z')

describe('resolveCashReportRange (fuso local — brief 0015 AC-05)', () => {
  it('default = dia (hoje local do org)', () => {
    const r = resolveCashReportRange({}, TZ, NOW)
    expect(r.period).toBe('day')
    expect(r.fromDate).toBe('2026-05-15')
    expect(r.toDate).toBe('2026-05-15')
    expect(r.fromIso).toBe('2026-05-15T03:00:00.000Z')
    expect(r.toIso).toBe('2026-05-16T02:59:59.999Z')
  })

  it('week = últimos 7 dias terminando hoje', () => {
    const r = resolveCashReportRange({ period: 'week' }, TZ, NOW)
    expect(r.period).toBe('week')
    expect(r.fromDate).toBe('2026-05-09')
    expect(r.toDate).toBe('2026-05-15')
  })

  it('month = mês corrente até hoje', () => {
    const r = resolveCashReportRange({ period: 'month' }, TZ, NOW)
    expect(r.period).toBe('month')
    expect(r.fromDate).toBe('2026-05-01')
    expect(r.toDate).toBe('2026-05-15')
  })

  it('custom honra from/to válidos', () => {
    const r = resolveCashReportRange(
      { period: 'custom', from: '2026-05-01', to: '2026-05-03' },
      TZ,
      NOW,
    )
    expect(r.period).toBe('custom')
    expect(r.fromDate).toBe('2026-05-01')
    expect(r.toDate).toBe('2026-05-03')
    expect(r.fromIso).toBe('2026-05-01T03:00:00.000Z')
  })

  it('custom inverte from/to quando vêm trocados', () => {
    const r = resolveCashReportRange(
      { period: 'custom', from: '2026-05-10', to: '2026-05-05' },
      TZ,
      NOW,
    )
    expect(r.fromDate).toBe('2026-05-05')
    expect(r.toDate).toBe('2026-05-10')
  })

  it('custom sem datas válidas cai pro dia (hoje)', () => {
    const r = resolveCashReportRange({ period: 'custom', from: 'garbage' }, TZ, NOW)
    expect(r.period).toBe('day')
    expect(r.fromDate).toBe('2026-05-15')
    expect(r.toDate).toBe('2026-05-15')
  })

  it('sem period mas com from/to → custom (compat filtros antigos)', () => {
    const r = resolveCashReportRange({ from: '2026-05-01', to: '2026-05-03' }, TZ, NOW)
    expect(r.period).toBe('custom')
    expect(r.fromDate).toBe('2026-05-01')
    expect(r.toDate).toBe('2026-05-03')
  })

  it('fromIso <= toIso sempre', () => {
    const r = resolveCashReportRange({ period: 'week' }, TZ, NOW)
    expect(new Date(r.fromIso).getTime()).toBeLessThan(new Date(r.toIso).getTime())
  })
})
