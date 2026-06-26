import { describe, expect, it } from 'vitest'
import {
  computeGoalTracking,
  partialLabelKind,
  realizedAfterCommission,
  resolveGoalPeriodWindow,
  runRateProjectionCents,
} from './tracking'

describe('resolveGoalPeriodWindow', () => {
  const tz = 'America/Sao_Paulo'

  it('current month: elapsedDays = day-of-month, full days in month', () => {
    const w = resolveGoalPeriodWindow('2026-06', tz, new Date('2026-06-10T12:00:00Z'))
    expect(w.daysInMonth).toBe(30)
    expect(w.elapsedDays).toBe(10)
  })

  it('past month: complete (elapsedDays == daysInMonth)', () => {
    const w = resolveGoalPeriodWindow('2026-02', tz, new Date('2026-06-10T12:00:00Z'))
    expect(w.daysInMonth).toBe(28)
    expect(w.elapsedDays).toBe(28)
  })

  it('future month: nothing elapsed', () => {
    const w = resolveGoalPeriodWindow('2026-09', tz, new Date('2026-06-10T12:00:00Z'))
    expect(w.elapsedDays).toBe(0)
  })
})

describe('realizedAfterCommission', () => {
  it('subtracts commission from revenue', () => {
    expect(realizedAfterCommission(100_000, 15_000)).toBe(85_000)
  })
})

describe('runRateProjectionCents', () => {
  it('extrapolates linearly by elapsed days', () => {
    // 30_000 in 10 of 30 days → 90_000 projected.
    expect(runRateProjectionCents(30_000, 10, 30, true)).toBe(90_000)
  })

  it('is n/d (null) when there are no sales (AC-05)', () => {
    expect(runRateProjectionCents(0, 15, 30, false)).toBeNull()
  })

  it('is n/d (null) on the first day, never divides by zero', () => {
    expect(runRateProjectionCents(0, 0, 30, true)).toBeNull()
  })
})

describe('partialLabelKind (AC-06)', () => {
  it('after-commission when commission was subtracted', () => {
    expect(partialLabelKind(15_000)).toBe('after-commission')
  })

  it('revenue-only when there is no commission (SaaS / produto-puro)', () => {
    expect(partialLabelKind(0)).toBe('revenue-only')
  })
})

describe('computeGoalTracking', () => {
  it('full case: realizado-após-comissão, pace and projection', () => {
    const t = computeGoalTracking({
      targetCents: 100_000,
      revenueCents: 40_000,
      commissionCents: 10_000,
      elapsedDays: 10,
      daysInMonth: 30,
    })
    expect(t.realizedCents).toBe(30_000)
    expect(t.partialLabel).toBe('after-commission')
    expect(t.pacePct).toBe(30)
    expect(t.projectionCents).toBe(90_000)
    expect(t.projectionPct).toBe(90)
  })

  it('degenerate: no sales → projection n/d, pace 0, does not throw', () => {
    const t = computeGoalTracking({
      targetCents: 100_000,
      revenueCents: 0,
      commissionCents: 0,
      elapsedDays: 12,
      daysInMonth: 30,
    })
    expect(t.realizedCents).toBe(0)
    expect(t.projectionCents).toBeNull()
    expect(t.projectionPct).toBeNull()
    expect(t.pacePct).toBe(0)
    expect(t.partialLabel).toBe('revenue-only')
  })

  it('no commission but with revenue → revenue-only label, realizado = receita pura', () => {
    const t = computeGoalTracking({
      targetCents: 50_000,
      revenueCents: 20_000,
      commissionCents: 0,
      elapsedDays: 10,
      daysInMonth: 30,
    })
    expect(t.realizedCents).toBe(20_000)
    expect(t.partialLabel).toBe('revenue-only')
  })
})
