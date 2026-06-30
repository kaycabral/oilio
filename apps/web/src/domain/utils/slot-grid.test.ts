import { describe, expect, it } from 'vitest'
import type { BusinessHours } from '../types/unit'
import { isStartAtOnGrid } from './slot-grid'

const BR = 'America/Sao_Paulo'

// 2026-08-17 is a Monday. Business hours 09:00–12:00 BR = 12:00–15:00 UTC.
// 30-min grid: valid starts 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 BR
// (= 12:00, 12:30, 13:00, 13:30, 14:00, 14:30 UTC). 12:00 BR is the close.
function bh(opts: Partial<BusinessHours> = {}): BusinessHours {
  const range = { open: '09:00', close: '12:00' }
  return {
    monday: range,
    tuesday: range,
    wednesday: range,
    thursday: range,
    friday: range,
    saturday: null,
    sunday: null,
    ...opts,
  }
}

describe('isStartAtOnGrid', () => {
  it('accepts a start that lands on a 30-min grid step inside hours', () => {
    expect(
      isStartAtOnGrid({
        // 10:00 BR
        startAt: '2026-08-17T13:00:00.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(true)
  })

  it('accepts the first slot at the open time', () => {
    expect(
      isStartAtOnGrid({
        // 09:00 BR (open)
        startAt: '2026-08-17T12:00:00.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(true)
  })

  it('rejects a start between grid steps', () => {
    expect(
      isStartAtOnGrid({
        // 09:15 BR (off the 30-min grid)
        startAt: '2026-08-17T12:15:00.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start before opening', () => {
    expect(
      isStartAtOnGrid({
        // 08:30 BR (before 09:00)
        startAt: '2026-08-17T11:30:00.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start at the closing time (slot must start before close)', () => {
    expect(
      isStartAtOnGrid({
        // 12:00 BR (close)
        startAt: '2026-08-17T15:00:00.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start on a closed weekday', () => {
    expect(
      isStartAtOnGrid({
        // Sunday 10:00 BR
        startAt: '2026-08-16T13:00:00.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects every start when hours are unconfigured', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T13:00:00.000Z',
        slotMinutes: 30,
        businessHours: null,
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a forged start carrying sub-minute precision', () => {
    expect(
      isStartAtOnGrid({
        // 10:00:30 BR — off-grid by seconds
        startAt: '2026-08-17T13:00:30.000Z',
        slotMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('aligns to a split-shift second window independently', () => {
    const split = bh({
      monday: [
        { open: '09:00', close: '12:00' },
        { open: '14:00', close: '18:00' },
      ],
    })
    // 14:00 BR = 17:00 UTC — first slot of the afternoon window.
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T17:00:00.000Z',
        slotMinutes: 30,
        businessHours: split,
        timezone: BR,
      }),
    ).toBe(true)
    // 12:30 BR = 15:30 UTC — inside the lunch gap.
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T15:30:00.000Z',
        slotMinutes: 30,
        businessHours: split,
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('respects a non-default grid granularity (15 min)', () => {
    expect(
      isStartAtOnGrid({
        // 09:15 BR — valid on a 15-min grid
        startAt: '2026-08-17T12:15:00.000Z',
        slotMinutes: 15,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(true)
  })

  it('treats a non-positive grid as no valid slot', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T13:00:00.000Z',
        slotMinutes: 0,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })
})
