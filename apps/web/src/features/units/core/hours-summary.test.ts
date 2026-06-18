import { describe, expect, it } from 'vitest'

import type { BusinessHours } from '@/domain'

import { summarizeHours } from './hours-summary'

const R = { open: '09:00', close: '18:00' }

function hours(open: Partial<Record<keyof BusinessHours, BusinessHours['monday']>>): BusinessHours {
  return {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
    ...open,
  }
}

describe('summarizeHours', () => {
  it('returns null when hours are absent or every day is closed', () => {
    expect(summarizeHours({ businessHours: null })).toBeNull()
    expect(summarizeHours({ businessHours: hours({}) })).toBeNull()
  })

  it('summarizes a contiguous weekday range with a uniform time', () => {
    expect(
      summarizeHours({
        hoursMode: 'fixed',
        businessHours: hours({ monday: R, tuesday: R, wednesday: R, thursday: R, friday: R }),
      }),
    ).toEqual({ days: 'Seg a Sex', time: '9h–18h' })
  })

  it('labels all seven days and the 24h mode', () => {
    const allDay = { open: '00:00', close: '23:59' }
    expect(
      summarizeHours({
        hoursMode: 'always_open',
        businessHours: hours({
          monday: allDay,
          tuesday: allDay,
          wednesday: allDay,
          thursday: allDay,
          friday: allDay,
          saturday: allDay,
          sunday: allDay,
        }),
      }),
    ).toEqual({ days: 'Todos os dias', time: '24h' })
  })

  it('lists non-contiguous days and omits the time when ranges differ', () => {
    expect(
      summarizeHours({
        hoursMode: 'fixed',
        businessHours: hours({
          monday: R,
          wednesday: { open: '10:00', close: '16:00' },
          friday: R,
        }),
      }),
    ).toEqual({ days: 'Seg, Qua, Sex', time: null })
  })

  it('keeps minutes in the time range', () => {
    expect(
      summarizeHours({
        hoursMode: 'appointment',
        businessHours: hours({ saturday: { open: '08:30', close: '12:00' } }),
      }),
    ).toEqual({ days: 'Sáb', time: '8h30–12h' })
  })

  it('reads an all-day fixed range as "24h" (00:00–24:00, not always_open mode)', () => {
    expect(
      summarizeHours({
        hoursMode: 'fixed',
        businessHours: hours({ tuesday: { open: '00:00', close: '24:00' } }),
      }),
    ).toEqual({ days: 'Ter', time: '24h' })
  })

  it('omits the time when an open day has a multi-interval (split-shift) range', () => {
    expect(
      summarizeHours({
        hoursMode: 'fixed',
        businessHours: hours({
          monday: [
            { open: '09:00', close: '12:00' },
            { open: '13:00', close: '18:00' },
          ],
        }),
      }),
    ).toEqual({ days: 'Seg', time: null })
  })
})
