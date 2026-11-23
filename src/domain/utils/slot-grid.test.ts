import { describe, expect, it } from 'vitest'
import type { BusinessHours } from '../types/unit'
import { isStartAtOnGrid } from './slot-grid'

const BR = 'America/Sao_Paulo'

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
        startAt: '2026-08-17T13:00:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(true)
  })

  it('accepts the first slot at the open time', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T12:00:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(true)
  })

  it('rejects a start between grid steps', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T12:15:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start before opening', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T11:30:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start at the closing time (slot must start before close)', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T15:00:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start on a closed weekday', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-16T13:00:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
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
        durationMinutes: 30,
        businessHours: null,
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a forged start carrying sub-minute precision', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T13:00:30.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
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
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T17:00:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: split,
        timezone: BR,
      }),
    ).toBe(true)
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T15:30:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: split,
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('respects a non-default grid granularity (15 min)', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T12:15:00.000Z',
        slotMinutes: 15,
        durationMinutes: 30,
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
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
  })

  it('rejects a start whose service overruns the closing time', () => {
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T14:30:00.000Z',
        slotMinutes: 30,
        durationMinutes: 60,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(false)
    expect(
      isStartAtOnGrid({
        startAt: '2026-08-17T14:30:00.000Z',
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
      }),
    ).toBe(true)
  })

  it('rejects a start strictly before the nowMs cutoff (past slot)', () => {
    const start = '2026-08-17T13:00:00.000Z'
    expect(
      isStartAtOnGrid({
        startAt: start,
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
        nowMs: new Date('2026-08-17T13:30:00.000Z').getTime(),
      }),
    ).toBe(false)
    expect(
      isStartAtOnGrid({
        startAt: start,
        slotMinutes: 30,
        durationMinutes: 30,
        businessHours: bh(),
        timezone: BR,
        nowMs: new Date('2026-08-17T12:00:00.000Z').getTime(),
      }),
    ).toBe(true)
  })
})
