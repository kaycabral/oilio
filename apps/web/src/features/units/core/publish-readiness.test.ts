import type { BusinessHours } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  computeUnitPublishReadiness,
  isUnitPubliclyLive,
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

  it('is false for a fixed unit whose week is all-closed (zero-value hours)', () => {
    // v2: the agenda always carries a businessHours object — the EMPTY all-closed
    // week is the zero-value a fresh/under-configured unit holds and must NOT
    // count as "has hours" (defers to isBusinessHoursConfigured).
    expect(unitHasAddressAndHours({ mode: 'fixed', businessHours: EMPTY })).toBe(false)
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

// SPIKE (inferred availability): a unit is publicly live with no stored publish
// flag — appointment mode + configured hours. Service/pro are feedback only.
describe('isUnitPubliclyLive', () => {
  it('is true for an appointment unit with at least one open day', () => {
    expect(
      isUnitPubliclyLive({
        agenda: {
          mode: 'appointment',
          businessHours: HOURS,
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
          selfBookingPublished: false,
        },
      }),
    ).toBe(true)
  })

  it('is false for an appointment unit with an all-closed week (no hours)', () => {
    expect(
      isUnitPubliclyLive({
        agenda: {
          mode: 'appointment',
          businessHours: EMPTY,
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
          selfBookingPublished: false,
        },
      }),
    ).toBe(false)
  })

  it('is false for a non-appointment (fixed) unit even with hours', () => {
    expect(isUnitPubliclyLive({ agenda: { mode: 'fixed', businessHours: HOURS } })).toBe(false)
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
