import {
  type BusinessHours,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_SLOT_MINUTES,
  type UnitAgendaAppointment,
} from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  assembleAgenda,
  parseAddress,
  parseBusinessHours,
  parseHoursMode,
  parseUnitForm,
} from './unit-form'

function fd(entries: Record<string, string>): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(entries)) form.append(k, v)
  return form
}

const VALID_ADDRESS: Record<string, string> = {
  postalCode: '01310-100',
  state: 'SP',
  city: 'São Paulo',
  neighborhood: 'Bela Vista',
  street: 'Av. Paulista',
  number: '1000',
}

describe('parseAddress', () => {
  it('parses a complete address, stripping CEP punctuation and defaulting complement to null', () => {
    expect(parseAddress(fd(VALID_ADDRESS))).toEqual({
      postalCode: '01310100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Av. Paulista',
      number: '1000',
      complement: null,
    })
  })

  it('rejects an invalid CEP', () => {
    expect(typeof parseAddress(fd({ ...VALID_ADDRESS, postalCode: '123' }))).toBe('string')
  })

  it('rejects an incomplete address', () => {
    const { city: _city, ...rest } = VALID_ADDRESS
    expect(typeof parseAddress(fd(rest))).toBe('string')
  })

  it('rejects a missing number', () => {
    const { number: _number, ...rest } = VALID_ADDRESS
    expect(typeof parseAddress(fd(rest))).toBe('string')
  })
})

describe('parseHoursMode', () => {
  it('defaults to fixed when absent', () => {
    expect(parseHoursMode(new FormData())).toBe('fixed')
  })

  it('reads a known mode', () => {
    expect(parseHoursMode(fd({ hoursMode: 'always_open' }))).toBe('always_open')
  })

  it('falls back to fixed for an unknown value', () => {
    expect(parseHoursMode(fd({ hoursMode: 'bogus' }))).toBe('fixed')
  })
})

describe('parseBusinessHours', () => {
  it('returns null when no day is enabled', () => {
    expect(parseBusinessHours(new FormData(), 'fixed')).toBeNull()
  })

  it('parses a fixed-mode day with a single range', () => {
    const result = parseBusinessHours(
      fd({ bh_monday_enabled: 'on', bh_monday_0_open: '09:00', bh_monday_0_close: '18:00' }),
      'fixed',
    )
    expect(result).toMatchObject({ monday: [{ open: '09:00', close: '18:00' }], tuesday: null })
  })

  it('treats an enabled day in always_open mode as the whole day', () => {
    const result = parseBusinessHours(fd({ bh_monday_enabled: 'on' }), 'always_open')
    expect(result).toMatchObject({ monday: [{ open: '00:00', close: '23:59' }] })
  })

  it('errors when an enabled fixed day has no range', () => {
    expect(typeof parseBusinessHours(fd({ bh_monday_enabled: 'on' }), 'fixed')).toBe('string')
  })

  it('errors on an invalid range', () => {
    const result = parseBusinessHours(
      fd({ bh_monday_enabled: 'on', bh_monday_0_open: '18:00', bh_monday_0_close: '09:00' }),
      'fixed',
    )
    expect(typeof result).toBe('string')
  })
})

const VALID_UNIT: Record<string, string> = {
  ...VALID_ADDRESS,
  name: 'Matriz',
  whatsapp: '11999998888',
  bh_monday_enabled: 'on',
  bh_monday_0_open: '09:00',
  bh_monday_0_close: '18:00',
}

describe('parseUnitForm', () => {
  it('parses a valid unit with derived defaults', () => {
    const result = parseUnitForm(fd(VALID_UNIT))
    expect(result).toMatchObject({
      name: 'Matriz',
      slug: '',
      email: null,
      hoursMode: 'fixed',
    })
    expect(typeof result === 'object' ? result.whatsapp : '').toMatch(/\d/)
  })

  it('rejects a too-short name', () => {
    expect(typeof parseUnitForm(fd({ ...VALID_UNIT, name: 'A' }))).toBe('string')
  })

  it('rejects an explicit invalid slug', () => {
    expect(typeof parseUnitForm(fd({ ...VALID_UNIT, slug: 'A B' }))).toBe('string')
  })

  it('rejects a missing whatsapp', () => {
    const { whatsapp: _w, ...rest } = VALID_UNIT
    expect(typeof parseUnitForm(fd(rest))).toBe('string')
  })

  it('propagates an address error', () => {
    expect(typeof parseUnitForm(fd({ ...VALID_UNIT, postalCode: '1' }))).toBe('string')
  })

  it('propagates a business-hours error', () => {
    expect(
      typeof parseUnitForm(
        fd({ ...VALID_UNIT, bh_monday_0_open: '20:00', bh_monday_0_close: '08:00' }),
      ),
    ).toBe('string')
  })

  it('rejects a unit with no operating day declared (hours REQUIRED in v2)', () => {
    // No `bh_*_enabled` => parseBusinessHours returns null. A unit is an
    // operating establishment, so the empty hours config is rejected at the
    // boundary rather than producing a unit without businessHours (PRD
    // Identidade v2 § Contrato de tipagem).
    const noDays = { ...VALID_ADDRESS, name: 'Matriz', whatsapp: '11999998888' }
    expect(typeof parseUnitForm(fd(noDays))).toBe('string')
  })
})

const HOURS: BusinessHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

// assembleAgenda builds the discriminated union from the parsed mode + hours
// (PRD Identidade v2, context 3). The appointment-only configs exist ONLY in the
// appointment variant; on edit they are PRESERVED from the prior agenda.
describe('assembleAgenda', () => {
  it('builds the fixed variant (no agenda-only configs)', () => {
    expect(assembleAgenda('fixed', HOURS, null)).toEqual({ mode: 'fixed', businessHours: HOURS })
  })

  it('builds the always_open variant (no businessHours, no configs)', () => {
    expect(assembleAgenda('always_open', HOURS, null)).toEqual({ mode: 'always_open' })
  })

  it('seeds appointment defaults when switching into appointment mode for the first time', () => {
    const agenda = assembleAgenda('appointment', HOURS, null)
    expect(agenda.mode).toBe('appointment')
    if (agenda.mode !== 'appointment') throw new Error('expected appointment')
    expect(agenda.businessHours).toEqual(HOURS)
    expect(agenda.slotMinutes).toBe(DEFAULT_SLOT_MINUTES)
    expect(agenda.cancellationPolicy).toEqual(DEFAULT_CANCELLATION_POLICY)
    expect(agenda.selfBookingPublished).toBe(false)
    // No prior publish timestamp → the optional field is omitted.
    expect('selfBookingPublishedAt' in agenda).toBe(false)
  })

  it('preserves the prior appointment configs on edit (form does not expose them)', () => {
    const prior: UnitAgendaAppointment = {
      mode: 'appointment',
      businessHours: HOURS,
      slotMinutes: 30,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 240 },
      confirmationTemplates: { confirmation: 'c', reminder: 'r', cancellation: 'x' },
      selfBookingPublished: true,
      selfBookingPublishedAt: '2026-06-18T00:00:00.000Z',
    }
    const newHours: BusinessHours = { ...HOURS, tuesday: { open: '10:00', close: '16:00' } }
    const agenda = assembleAgenda('appointment', newHours, prior)
    if (agenda.mode !== 'appointment') throw new Error('expected appointment')
    // Hours come from the new form input; the agenda-only configs are preserved.
    expect(agenda.businessHours).toEqual(newHours)
    expect(agenda.slotMinutes).toBe(30)
    expect(agenda.cancellationPolicy).toEqual({ enabled: true, minNoticeMinutes: 240 })
    expect(agenda.confirmationTemplates).toEqual(prior.confirmationTemplates)
    expect(agenda.selfBookingPublished).toBe(true)
    expect(agenda.selfBookingPublishedAt).toBe('2026-06-18T00:00:00.000Z')
  })

  it('drops the appointment configs when switching appointment → fixed', () => {
    const prior: UnitAgendaAppointment = {
      mode: 'appointment',
      businessHours: HOURS,
      slotMinutes: 30,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 240 },
      confirmationTemplates: { confirmation: 'c', reminder: 'r', cancellation: 'x' },
      selfBookingPublished: true,
    }
    expect(assembleAgenda('fixed', HOURS, prior)).toEqual({ mode: 'fixed', businessHours: HOURS })
  })

  it('does not carry a prior fixed agenda into appointment defaults', () => {
    const agenda = assembleAgenda('appointment', HOURS, { mode: 'fixed', businessHours: HOURS })
    if (agenda.mode !== 'appointment') throw new Error('expected appointment')
    // A non-appointment prior is treated as no prior → defaults.
    expect(agenda.slotMinutes).toBe(DEFAULT_SLOT_MINUTES)
    expect(agenda.selfBookingPublished).toBe(false)
  })
})
