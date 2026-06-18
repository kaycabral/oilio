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

// `summarizeHours` takes the unit's agenda union (PRD Identidade v2 — hours
// moved into `Unit.agenda`). The fixed/appointment variants carry businessHours;
// always_open carries none and summarizes to "24h".
function fixed(bh: BusinessHours) {
  return { agenda: { mode: 'fixed' as const, businessHours: bh } }
}

describe('summarizeHours', () => {
  it('returns null when every day is closed', () => {
    expect(summarizeHours(fixed(hours({})))).toBeNull()
  })

  it('summarizes a contiguous weekday range with a uniform time', () => {
    expect(
      summarizeHours(fixed(hours({ monday: R, tuesday: R, wednesday: R, thursday: R, friday: R }))),
    ).toEqual({ days: 'Seg a Sex', time: '9h–18h' })
  })

  it('labels the always_open mode as all days / 24h', () => {
    expect(summarizeHours({ agenda: { mode: 'always_open' } })).toEqual({
      days: 'Todos os dias',
      time: '24h',
    })
  })

  it('lists non-contiguous days and omits the time when ranges differ', () => {
    expect(
      summarizeHours(
        fixed(hours({ monday: R, wednesday: { open: '10:00', close: '16:00' }, friday: R })),
      ),
    ).toEqual({ days: 'Seg, Qua, Sex', time: null })
  })

  it('keeps minutes in the time range (appointment variant)', () => {
    expect(
      summarizeHours({
        agenda: {
          mode: 'appointment',
          businessHours: hours({ saturday: { open: '08:30', close: '12:00' } }),
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
          selfBookingPublished: false,
        },
      }),
    ).toEqual({ days: 'Sáb', time: '8h30–12h' })
  })

  it('reads an all-day fixed range as "24h" (00:00–24:00, not always_open mode)', () => {
    expect(summarizeHours(fixed(hours({ tuesday: { open: '00:00', close: '24:00' } })))).toEqual({
      days: 'Ter',
      time: '24h',
    })
  })

  it('omits the time when an open day has a multi-interval (split-shift) range', () => {
    expect(
      summarizeHours(
        fixed(
          hours({
            monday: [
              { open: '09:00', close: '12:00' },
              { open: '13:00', close: '18:00' },
            ],
          }),
        ),
      ),
    ).toEqual({ days: 'Seg', time: null })
  })
})
