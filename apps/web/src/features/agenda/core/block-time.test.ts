import { describe, expect, it } from 'vitest'
import { oneOffToLocal } from './block-time'

// UTC-3 (no DST in 2026).
const BR = 'America/Sao_Paulo'

describe('oneOffToLocal', () => {
  it('converts a UTC range into org-local date + HH:mm strings', () => {
    // 12:00–13:30 UTC → 09:00–10:30 in BR (UTC-3).
    const local = oneOffToLocal('2026-06-01T12:00:00.000Z', '2026-06-01T13:30:00.000Z', BR)
    expect(local).toEqual({ date: '2026-06-01', start: '09:00', end: '10:30' })
  })

  it('zero-pads single-digit hours and minutes', () => {
    // 11:05 UTC → 08:05 BR.
    const local = oneOffToLocal('2026-06-01T11:05:00.000Z', '2026-06-01T11:09:00.000Z', BR)
    expect(local.start).toBe('08:05')
    expect(local.end).toBe('08:09')
  })

  it('rolls the local date back across the UTC midnight boundary', () => {
    // 01:30 UTC on Jun 2 → 22:30 BR on Jun 1.
    const local = oneOffToLocal('2026-06-02T01:30:00.000Z', '2026-06-02T02:00:00.000Z', BR)
    expect(local.date).toBe('2026-06-01')
    expect(local.start).toBe('22:30')
  })
})
