import { describe, expect, it } from 'vitest'
import { oneOffToLocal } from './block-time'

const BR = 'America/Sao_Paulo'

describe('oneOffToLocal', () => {
  it('converts a UTC range into org-local date + HH:mm strings', () => {
    const local = oneOffToLocal('2026-06-01T12:00:00.000Z', '2026-06-01T13:30:00.000Z', BR)
    expect(local).toEqual({ date: '2026-06-01', start: '09:00', end: '10:30' })
  })

  it('zero-pads single-digit hours and minutes', () => {
    const local = oneOffToLocal('2026-06-01T11:05:00.000Z', '2026-06-01T11:09:00.000Z', BR)
    expect(local.start).toBe('08:05')
    expect(local.end).toBe('08:09')
  })

  it('rolls the local date back across the UTC midnight boundary', () => {
    const local = oneOffToLocal('2026-06-02T01:30:00.000Z', '2026-06-02T02:00:00.000Z', BR)
    expect(local.date).toBe('2026-06-01')
    expect(local.start).toBe('22:30')
  })
})
