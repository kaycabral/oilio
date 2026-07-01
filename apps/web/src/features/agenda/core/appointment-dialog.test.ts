import { fromOrgTime } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  buildAppointmentWhatsappLink,
  gridTimeOptions,
  resolveInitialDateTime,
  resolveStartTimePicker,
} from './appointment-dialog'

const TZ = 'America/Sao_Paulo'
const apptArgs = {
  appointment: {
    customerId: 'c1',
    serviceId: 's1',
    memberOperationId: 'p1',
    startAt: '2026-06-15T13:00:00.000Z',
  },
  customers: [{ id: 'c1', name: 'Ana', whatsapp: '5511999990000' }],
  services: [{ id: 's1', name: 'Corte' }],
  memberOperations: [{ id: 'p1', name: 'Bruno' }],
  timezone: TZ,
  confirmationTemplate:
    'Oi {{customerName}}, seu {{serviceName}} com {{memberOperationName}} em {{date}} às {{time}} ({{businessName}}).',
  businessName: 'Salão X',
}

describe('buildAppointmentWhatsappLink', () => {
  it('returns null for a new appointment (none passed)', () => {
    expect(buildAppointmentWhatsappLink({ ...apptArgs, appointment: null })).toBeNull()
    expect(buildAppointmentWhatsappLink({ ...apptArgs, appointment: undefined })).toBeNull()
  })

  it('returns null when the customer no longer resolves', () => {
    expect(buildAppointmentWhatsappLink({ ...apptArgs, customers: [] })).toBeNull()
  })

  it('builds a wa.me link with the rendered confirmation message', () => {
    const link = buildAppointmentWhatsappLink(apptArgs)
    expect(link).not.toBeNull()
    expect(link).toContain('5511999990000')
    const decoded = decodeURIComponent(link!)
    expect(decoded).toContain('Ana')
    expect(decoded).toContain('Corte')
    expect(decoded).toContain('Bruno')
    expect(decoded).toContain('Salão X')
    // 13:00 UTC → 10:00 São Paulo, date dd/mm/yyyy
    expect(decoded).toContain('15/06/2026')
    expect(decoded).toContain('10:00')
  })

  it('still builds the link when service/memberOperation are missing (optional fields)', () => {
    const link = buildAppointmentWhatsappLink({ ...apptArgs, services: [], memberOperations: [] })
    expect(link).not.toBeNull()
    expect(decodeURIComponent(link!)).toContain('Ana')
  })
})

describe('resolveInitialDateTime', () => {
  it('uses the clicked date + default time for a new appointment', () => {
    expect(resolveInitialDateTime(null, '2026-07-01', '14:30', TZ)).toEqual({
      date: '2026-07-01',
      startTime: '14:30',
    })
  })

  it('falls back to 09:00 when no default time is given', () => {
    expect(resolveInitialDateTime(undefined, '2026-07-01', undefined, TZ)).toEqual({
      date: '2026-07-01',
      startTime: '09:00',
    })
  })

  it('reads the appointment start (converted to org tz) in edit mode', () => {
    expect(
      resolveInitialDateTime({ startAt: '2026-06-15T13:00:00.000Z' }, '2026-01-01', '08:00', TZ),
    ).toEqual({
      date: '2026-06-15',
      startTime: '10:00',
    })
  })
})

describe('gridTimeOptions', () => {
  it('steps a single range by slotMinutes, last start fits the duration', () => {
    expect(gridTimeOptions([{ open: '09:00', close: '11:00' }], 30, 30)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
    ])
  })

  it('trims the tail when the service overruns the close', () => {
    // 60-min service in a 09:00–11:00 window on a 30-min grid: last valid start
    // is 10:00 (ends 11:00); 10:30 would end 11:30, past close.
    expect(gridTimeOptions([{ open: '09:00', close: '11:00' }], 30, 60)).toEqual([
      '09:00',
      '09:30',
      '10:00',
    ])
  })

  it('covers split shifts as one ascending, de-duped list', () => {
    expect(
      gridTimeOptions(
        [
          { open: '09:00', close: '10:00' },
          { open: '14:00', close: '15:00' },
        ],
        30,
        30,
      ),
    ).toEqual(['09:00', '09:30', '14:00', '14:30'])
  })

  it('returns no options for a closed day', () => {
    expect(gridTimeOptions([], 30, 30)).toEqual([])
  })

  it('returns no options for a non-positive grid', () => {
    expect(gridTimeOptions([{ open: '09:00', close: '12:00' }], 0, 30)).toEqual([])
  })

  it('returns no options for a non-positive duration', () => {
    expect(gridTimeOptions([{ open: '09:00', close: '12:00' }], 30, 0)).toEqual([])
  })

  it('respects a finer granularity', () => {
    expect(gridTimeOptions([{ open: '09:00', close: '10:00' }], 15, 15)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
    ])
  })

  describe('pastCutoff (#1314 — drop past slots on the current day)', () => {
    const DATE = '2026-07-01'
    // nowMs anchored to 10:00 org-local on DATE.
    const nowMs = new Date(fromOrgTime({ date: DATE, hour: 10, minute: 0 }, TZ)).getTime()

    it('omits slots before nowMs, keeps the rest', () => {
      expect(
        gridTimeOptions([{ open: '09:00', close: '12:00' }], 30, 30, {
          date: DATE,
          timezone: TZ,
          nowMs,
        }),
      ).toEqual(['10:00', '10:30', '11:00', '11:30'])
    })

    it('keeps the slot whose start equals nowMs (>= cutoff)', () => {
      // 10:00 starts exactly at nowMs and must remain (rule is `startMs >= nowMs`).
      const opts = gridTimeOptions([{ open: '09:00', close: '12:00' }], 30, 30, {
        date: DATE,
        timezone: TZ,
        nowMs,
      })
      expect(opts).toContain('10:00')
      expect(opts).not.toContain('09:30')
    })

    it('is unchanged when no cutoff is passed (retro-compatible)', () => {
      expect(gridTimeOptions([{ open: '09:00', close: '11:00' }], 30, 30)).toEqual([
        '09:00',
        '09:30',
        '10:00',
        '10:30',
      ])
    })
  })
})

describe('resolveStartTimePicker (#1314 — NEW never preselects a past slot)', () => {
  // already past-cut (09:00/09:30 dropped)
  const GRID = ['10:00', '10:30', '11:00']

  it('NEW defaults to the first grid slot and never re-injects the fallback', () => {
    const r = resolveStartTimePicker({
      grid: GRID,
      editMode: false,
      // '09:00' is the past fallback
      initialStartTime: '09:00',
      keepInitial: true,
    })
    expect(r.options).toEqual(['10:00', '10:30', '11:00'])
    expect(r.options).not.toContain('09:00')
    expect(r.defaultValue).toBe('10:00')
  })

  it('NEW with an empty grid has no default (nothing to offer)', () => {
    const r = resolveStartTimePicker({
      grid: [],
      editMode: false,
      initialStartTime: '09:00',
      keepInitial: true,
    })
    expect(r.options).toEqual([])
    expect(r.defaultValue).toBeUndefined()
  })

  it('EDIT re-injects the appointment start when it fell off the grid', () => {
    const r = resolveStartTimePicker({
      grid: GRID,
      editMode: true,
      // '08:00' is off-grid (before open)
      initialStartTime: '08:00',
      keepInitial: true,
    })
    expect(r.options).toEqual(['08:00', '10:00', '10:30', '11:00'])
    expect(r.defaultValue).toBe('08:00')
  })

  it('EDIT keeps the on-grid start as default without duplicating it', () => {
    const r = resolveStartTimePicker({
      grid: GRID,
      editMode: true,
      initialStartTime: '10:30',
      keepInitial: true,
    })
    expect(r.options).toEqual(['10:00', '10:30', '11:00'])
    expect(r.defaultValue).toBe('10:30')
  })

  it('EDIT does not re-inject when the day changed (keepInitial false)', () => {
    const r = resolveStartTimePicker({
      grid: GRID,
      editMode: true,
      initialStartTime: '08:00',
      keepInitial: false,
    })
    expect(r.options).toEqual(['10:00', '10:30', '11:00'])
  })
})
