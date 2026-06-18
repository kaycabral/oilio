import type { BusinessHours } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  computeUnitPublishReadiness,
  UNIT_REQUIREMENTS,
  unitHasAddressAndHours,
} from './publish-readiness'

const HOURS: BusinessHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

const EMPTY: BusinessHours = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

// Per-unit self-booking publish readiness (PRD Identidade v2, context 3). Hours
// now live in the agenda union; `always_open` is open by definition, and a
// fixed/appointment unit needs at least one open day.
describe('unitHasAddressAndHours', () => {
  it('is true for always_open (open by definition)', () => {
    expect(unitHasAddressAndHours({ mode: 'always_open' })).toBe(true)
  })

  it('is true for a fixed unit with at least one open day', () => {
    expect(unitHasAddressAndHours({ mode: 'fixed', businessHours: HOURS })).toBe(true)
  })

  it('is true for a fixed unit that carries a businessHours object (even all-closed)', () => {
    // `unitBusinessHours` returns the object for fixed/appointment (only null for
    // always_open), so a fixed unit always "has hours" by this gate — matching
    // the original adapter behavior. Day-level emptiness is a separate concern.
    expect(unitHasAddressAndHours({ mode: 'fixed', businessHours: EMPTY })).toBe(true)
  })

  it('reads the appointment variant hours', () => {
    expect(
      unitHasAddressAndHours({
        mode: 'appointment',
        businessHours: HOURS,
        slotMinutes: 15,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        selfBookingPublished: false,
      }),
    ).toBe(true)
  })
})

describe('computeUnitPublishReadiness', () => {
  it('is ready when all three facts hold', () => {
    expect(
      computeUnitPublishReadiness({
        hasAddressAndHours: true,
        hasPublicService: true,
        hasOperationalProfessional: true,
      }),
    ).toEqual({ ready: true, missing: [] })
  })

  it('lists each unmet requirement in order', () => {
    expect(
      computeUnitPublishReadiness({
        hasAddressAndHours: false,
        hasPublicService: false,
        hasOperationalProfessional: false,
      }),
    ).toEqual({
      ready: false,
      missing: [
        UNIT_REQUIREMENTS.address,
        UNIT_REQUIREMENTS.service,
        UNIT_REQUIREMENTS.professional,
      ],
    })
  })

  it('reports only the single missing requirement', () => {
    const r = computeUnitPublishReadiness({
      hasAddressAndHours: true,
      hasPublicService: false,
      hasOperationalProfessional: true,
    })
    expect(r.ready).toBe(false)
    expect(r.missing).toEqual([UNIT_REQUIREMENTS.service])
  })
})
