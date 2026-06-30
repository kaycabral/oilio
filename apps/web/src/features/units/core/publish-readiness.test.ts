import type { Address, BusinessHours, Unit, UnitAgendaConfig } from '@/domain'
import { EMPTY_ADDRESS } from '@/domain'
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

const FULL_ADDRESS: Address = {
  postalCode: '01001-000',
  state: 'SP',
  city: 'São Paulo',
  neighborhood: 'Sé',
  street: 'Praça da Sé',
  number: '100',
  complement: null,
}

const unit = (address: Address, agenda: UnitAgendaConfig): Pick<Unit, 'address' | 'agenda'> => ({
  address,
  agenda,
})

// Per-unit self-booking publish readiness (PRD Identidade v2, context 3). A
// public unit needs a COMPLETE address AND usable hours. Hours live in the agenda
// union; `always_open` is open by definition, a fixed/appointment unit needs at
// least one open day. Address must be real — the schema tolerates empty strings
// (the aggregate zero-value), so a blank address must NOT count as ready.
describe('unitHasAddressAndHours', () => {
  it('is true for always_open with a complete address', () => {
    expect(unitHasAddressAndHours(unit(FULL_ADDRESS, { mode: 'always_open' }))).toBe(true)
  })

  it('is true for a fixed unit with a complete address + one open day', () => {
    expect(
      unitHasAddressAndHours(unit(FULL_ADDRESS, { mode: 'fixed', businessHours: HOURS })),
    ).toBe(true)
  })

  it('is false when the address is empty even with hours (the seeded-blank bug)', () => {
    expect(
      unitHasAddressAndHours(unit(EMPTY_ADDRESS, { mode: 'fixed', businessHours: HOURS })),
    ).toBe(false)
  })

  it('is false for a fixed unit whose week is all-closed (zero-value hours)', () => {
    // v2: the agenda always carries a businessHours object — the EMPTY all-closed
    // week is the zero-value a fresh/under-configured unit holds and must NOT
    // count as "has hours" (defers to isBusinessHoursConfigured).
    expect(
      unitHasAddressAndHours(unit(FULL_ADDRESS, { mode: 'fixed', businessHours: EMPTY })),
    ).toBe(false)
  })

  it('reads the appointment variant hours', () => {
    expect(
      unitHasAddressAndHours(
        unit(FULL_ADDRESS, {
          mode: 'appointment',
          businessHours: HOURS,
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        }),
      ),
    ).toBe(true)
  })
})

// SPIKE (inferred availability): a unit is publicly live with no stored publish
// flag — appointment mode + complete address + configured hours. Service/pro are
// feedback only.
describe('isUnitPubliclyLive', () => {
  it('is true for an appointment unit with a complete address + one open day', () => {
    expect(
      isUnitPubliclyLive(
        unit(FULL_ADDRESS, {
          mode: 'appointment',
          businessHours: HOURS,
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        }),
      ),
    ).toBe(true)
  })

  it('is false when the address is blank (the seeded-blank bug)', () => {
    expect(
      isUnitPubliclyLive(
        unit(EMPTY_ADDRESS, {
          mode: 'appointment',
          businessHours: HOURS,
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        }),
      ),
    ).toBe(false)
  })

  it('is false for an appointment unit with an all-closed week (no hours)', () => {
    expect(
      isUnitPubliclyLive(
        unit(FULL_ADDRESS, {
          mode: 'appointment',
          businessHours: EMPTY,
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        }),
      ),
    ).toBe(false)
  })

  it('is false for a non-appointment (fixed) unit even with hours', () => {
    expect(isUnitPubliclyLive(unit(FULL_ADDRESS, { mode: 'fixed', businessHours: HOURS }))).toBe(
      false,
    )
  })
})

describe('computeUnitPublishReadiness', () => {
  it('is ready when all three facts hold', () => {
    expect(
      computeUnitPublishReadiness({
        hasAddressAndHours: true,
        hasPublicService: true,
        hasOperationalMemberOperation: true,
      }),
    ).toEqual({ ready: true, missing: [] })
  })

  it('lists each unmet requirement in order', () => {
    expect(
      computeUnitPublishReadiness({
        hasAddressAndHours: false,
        hasPublicService: false,
        hasOperationalMemberOperation: false,
      }),
    ).toEqual({
      ready: false,
      missing: [
        UNIT_REQUIREMENTS.address,
        UNIT_REQUIREMENTS.service,
        UNIT_REQUIREMENTS.memberOperation,
      ],
    })
  })

  it('reports only the single missing requirement', () => {
    const r = computeUnitPublishReadiness({
      hasAddressAndHours: true,
      hasPublicService: false,
      hasOperationalMemberOperation: true,
    })
    expect(r.ready).toBe(false)
    expect(r.missing).toEqual([UNIT_REQUIREMENTS.service])
  })
})
