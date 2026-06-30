import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  type Address,
  appointmentAgenda,
  type BusinessHours,
  CompleteAddress,
  dayHoursToRanges,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_SLOT_MINUTES,
  EMPTY_ADDRESS,
  isAddressComplete,
  isReservedUnitSlug,
  isUnitBookable,
  isValidCancellationNoticeMinutes,
  isValidSlotMinutes,
  isValidUnitSlug,
  MAX_CANCELLATION_NOTICE_MINUTES,
  normalizeCancellationPolicy,
  slugifyUnitName,
  StoredUnit,
  Unit,
  type UnitAgendaConfig,
  unitBusinessHours,
  unitCancellationPolicySnapshot,
  UnitPii,
  unitSelfBookingPublished,
  unitSlotMinutes,
  unitUsesAgenda,
} from './unit'

const HOURS: BusinessHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

const APPOINTMENT_AGENDA: UnitAgendaConfig = {
  mode: 'appointment',
  businessHours: HOURS,
  slotMinutes: 30,
  cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
  confirmationTemplates: { confirmation: 'c', reminder: 'r', cancellation: 'x' },
  selfBookingPublished: true,
  selfBookingPublishedAt: '2026-06-18T00:00:00.000Z',
}

describe('slugifyUnitName', () => {
  it('normalizes accents and lowercases', () => {
    expect(slugifyUnitName('Filial São Paulo')).toBe('filial-sao-paulo')
    expect(slugifyUnitName('Centro Açaí')).toBe('centro-acai')
  })

  it('collapses non-alphanumerics and trims dashes', () => {
    expect(slugifyUnitName('  Matriz!!! ')).toBe('matriz')
  })
})

describe('isValidUnitSlug', () => {
  it('accepts canonical slugs', () => {
    expect(isValidUnitSlug('matriz')).toBe(true)
    expect(isValidUnitSlug('filial-centro')).toBe(true)
    expect(isValidUnitSlug('zona-sul-2')).toBe(true)
  })

  it('rejects bad format', () => {
    expect(isValidUnitSlug('ab')).toBe(false)
    expect(isValidUnitSlug('UPPER')).toBe(false)
    expect(isValidUnitSlug('-foo')).toBe(false)
    expect(isValidUnitSlug('foo bar')).toBe(false)
  })

  it('rejects reserved unit-scoped slugs', () => {
    expect(isValidUnitSlug('book')).toBe(false)
    expect(isValidUnitSlug('booking')).toBe(false)
    expect(isValidUnitSlug('me')).toBe(false)
    expect(isValidUnitSlug('admin')).toBe(false)
    expect(isReservedUnitSlug('book')).toBe(true)
    expect(isReservedUnitSlug('hello')).toBe(false)
  })

  it('rejects slugs that are reserved at the top-level (transitively, via isValidSlug)', () => {
    // `login` is reserved at top-level; isValidSlug rejects, so isValidUnitSlug
    // also rejects — keeps consistency between namespaces.
    expect(isValidUnitSlug('login')).toBe(false)
  })
})

// The agenda union (PRD Identidade v2, context 3) discriminates by mode — these
// derivations are the payoff: "uses agenda"/"is bookable" are computed from the
// agenda variant, and the agenda-only configs exist ONLY in appointment mode.
describe('unitUsesAgenda', () => {
  it('is true only for the appointment mode', () => {
    expect(unitUsesAgenda({ agenda: APPOINTMENT_AGENDA })).toBe(true)
    expect(unitUsesAgenda({ agenda: { mode: 'fixed', businessHours: HOURS } })).toBe(false)
    expect(unitUsesAgenda({ agenda: { mode: 'always_open' } })).toBe(false)
  })
})

describe('isUnitBookable', () => {
  it('is bookable when the unit uses the agenda', () => {
    expect(isUnitBookable({ agenda: APPOINTMENT_AGENDA })).toBe(true)
  })

  it('is not bookable for walk-in / always-open modes', () => {
    expect(isUnitBookable({ agenda: { mode: 'fixed', businessHours: HOURS } })).toBe(false)
    expect(isUnitBookable({ agenda: { mode: 'always_open' } })).toBe(false)
  })
})

describe('unitBusinessHours', () => {
  it('returns the per-day ranges for fixed / appointment', () => {
    expect(unitBusinessHours({ mode: 'fixed', businessHours: HOURS })).toEqual(HOURS)
    expect(unitBusinessHours(APPOINTMENT_AGENDA)).toEqual(HOURS)
  })

  it('is null for always_open (24h — no per-day ranges)', () => {
    expect(unitBusinessHours({ mode: 'always_open' })).toBeNull()
  })
})

describe('appointment-only config accessors', () => {
  it('appointmentAgenda returns the variant only in appointment mode', () => {
    expect(appointmentAgenda(APPOINTMENT_AGENDA)).toBe(APPOINTMENT_AGENDA)
    expect(appointmentAgenda({ mode: 'fixed', businessHours: HOURS })).toBeNull()
    expect(appointmentAgenda({ mode: 'always_open' })).toBeNull()
  })

  it('unitSlotMinutes reads the appointment slotMinutes, else the default', () => {
    expect(unitSlotMinutes(APPOINTMENT_AGENDA)).toBe(30)
    expect(unitSlotMinutes({ mode: 'fixed', businessHours: HOURS })).toBe(DEFAULT_SLOT_MINUTES)
    expect(unitSlotMinutes({ mode: 'always_open' })).toBe(DEFAULT_SLOT_MINUTES)
  })

  it('unitSelfBookingPublished is true only for a published appointment unit', () => {
    expect(unitSelfBookingPublished(APPOINTMENT_AGENDA)).toBe(true)
    expect(unitSelfBookingPublished({ ...APPOINTMENT_AGENDA, selfBookingPublished: false })).toBe(
      false,
    )
    expect(unitSelfBookingPublished({ mode: 'fixed', businessHours: HOURS })).toBe(false)
    expect(unitSelfBookingPublished({ mode: 'always_open' })).toBe(false)
  })

  it('unitCancellationPolicySnapshot reads the appointment policy, else the default', () => {
    expect(unitCancellationPolicySnapshot(APPOINTMENT_AGENDA)).toEqual({
      enabled: true,
      minNoticeMinutes: 120,
    })
    // Outside appointment mode the policy doesn't exist → normalized default.
    expect(unitCancellationPolicySnapshot({ mode: 'fixed', businessHours: HOURS })).toEqual({
      enabled: false,
      minNoticeMinutes: 120,
    })
    expect(unitCancellationPolicySnapshot({ mode: 'always_open' })).toEqual({
      enabled: false,
      minNoticeMinutes: 120,
    })
  })
})

// The agenda-only validators moved Org→Unit (context 3) — they now guard the
// appointment-variant fields.
describe('moved agenda validators (slotMinutes / cancellation notice)', () => {
  it('isValidSlotMinutes accepts the grid literals only', () => {
    expect(isValidSlotMinutes(15)).toBe(true)
    expect(isValidSlotMinutes(30)).toBe(true)
    expect(isValidSlotMinutes(7)).toBe(false)
    expect(isValidSlotMinutes('15')).toBe(false)
  })

  it('isValidCancellationNoticeMinutes bounds the notice window', () => {
    expect(isValidCancellationNoticeMinutes(0)).toBe(true)
    expect(isValidCancellationNoticeMinutes(MAX_CANCELLATION_NOTICE_MINUTES)).toBe(true)
    expect(isValidCancellationNoticeMinutes(-1)).toBe(false)
    expect(isValidCancellationNoticeMinutes(MAX_CANCELLATION_NOTICE_MINUTES + 1)).toBe(false)
    expect(isValidCancellationNoticeMinutes(1.5)).toBe(false)
  })
})

describe('normalizeCancellationPolicy', () => {
  it('returns the default policy when input is null/undefined or not an object', () => {
    expect(normalizeCancellationPolicy(null)).toEqual(DEFAULT_CANCELLATION_POLICY)
    expect(normalizeCancellationPolicy(undefined)).toEqual(DEFAULT_CANCELLATION_POLICY)
    expect(normalizeCancellationPolicy('not-an-object')).toEqual(DEFAULT_CANCELLATION_POLICY)
  })

  it('keeps valid fields and falls back to defaults for invalid ones', () => {
    expect(normalizeCancellationPolicy({ enabled: true, minNoticeMinutes: 30 })).toEqual({
      enabled: true,
      minNoticeMinutes: 30,
    })
    expect(normalizeCancellationPolicy({ enabled: 'sim', minNoticeMinutes: -10 })).toEqual({
      enabled: DEFAULT_CANCELLATION_POLICY.enabled,
      minNoticeMinutes: DEFAULT_CANCELLATION_POLICY.minNoticeMinutes,
    })
  })

  it('preserves minNoticeMinutes when enabled is false (so re-enable restores the value)', () => {
    expect(normalizeCancellationPolicy({ enabled: false, minNoticeMinutes: 240 })).toEqual({
      enabled: false,
      minNoticeMinutes: 240,
    })
  })
})

// Schema decode of the v2 Unit: `address`/`timezone`/`agenda` are now REQUIRED
// (no nullable hours) — these round-trips lock the contract and exercise the
// DayHours union (single range / multi-interval array / null), the Address
// NullOr fields, and the agenda discriminated union.
describe('Unit / StoredUnit schema (v2 — required address/timezone/agenda)', () => {
  const VALID_UNIT = {
    id: 'u1',
    orgId: 't1',
    name: 'Centro',
    slug: 'centro',
    whatsapp: '5511999998888',
    email: null,
    address: {
      postalCode: '01310-100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Av. Paulista',
      number: '1000',
      complement: null,
    },
    timezone: 'America/Sao_Paulo',
    agenda: {
      mode: 'fixed' as const,
      businessHours: {
        monday: { open: '09:00', close: '18:00' },
        tuesday: [
          { open: '09:00', close: '12:00' },
          { open: '13:00', close: '18:00' },
        ],
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      },
    },
    archivedAt: null,
    fiscal: { kind: 'informal' },
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  }

  it('decodes a full Unit with every DayHours variant', () => {
    const decoded = Schema.decodeUnknownSync(Unit)(VALID_UNIT)
    expect(decoded.address.street).toBe('Av. Paulista')
    expect(decoded.agenda.mode).toBe('fixed')
    expect(unitBusinessHours(decoded.agenda)?.wednesday).toBeNull()
  })

  it('decodes the appointment agenda variant carrying the agenda-only configs', () => {
    const decoded = Schema.decodeUnknownSync(Unit)({ ...VALID_UNIT, agenda: APPOINTMENT_AGENDA })
    expect(decoded.agenda.mode).toBe('appointment')
    if (decoded.agenda.mode !== 'appointment') throw new Error('expected appointment')
    expect(decoded.agenda.slotMinutes).toBe(30)
    expect(decoded.agenda.cancellationPolicy.enabled).toBe(true)
  })

  it('rejects a Unit with a null address (REQUIRED in v2)', () => {
    expect(() => Schema.decodeUnknownSync(Unit)({ ...VALID_UNIT, address: null })).toThrow()
  })

  // CompleteAddress is the schema the `unit.created`/`unit.updated` decode runs
  // through (#1283 / brief 0078 AC-05): a persisted unit must carry a real
  // address. The base `Address`/`Unit` stays permissive for the INITIAL
  // zero-value; the tightening lives in the event schema (tested via decode here).
  describe('CompleteAddress (event-boundary address invariant)', () => {
    it('decodes a complete address', () => {
      const decoded = Schema.decodeUnknownSync(CompleteAddress)(VALID_UNIT.address)
      expect(decoded.street).toBe('Av. Paulista')
    })

    it('rejects the all-empty EMPTY_ADDRESS zero-value', () => {
      expect(() => Schema.decodeUnknownSync(CompleteAddress)(EMPTY_ADDRESS)).toThrow()
    })

    it('rejects an address blank in a single required field (street)', () => {
      expect(() =>
        Schema.decodeUnknownSync(CompleteAddress)({ ...VALID_UNIT.address, street: '  ' }),
      ).toThrow()
    })

    it('still accepts a complete address missing the optional number/complement', () => {
      const decoded = Schema.decodeUnknownSync(CompleteAddress)({
        ...VALID_UNIT.address,
        number: null,
        complement: null,
      })
      expect(decoded.city).toBe('São Paulo')
    })
  })

  it('rejects a Unit with a null agenda (REQUIRED in v2)', () => {
    expect(() => Schema.decodeUnknownSync(Unit)({ ...VALID_UNIT, agenda: null })).toThrow()
  })

  it('rejects an appointment agenda missing the agenda-only configs', () => {
    expect(() =>
      Schema.decodeUnknownSync(Unit)({
        ...VALID_UNIT,
        agenda: { mode: 'appointment', businessHours: HOURS },
      }),
    ).toThrow()
  })

  it('StoredUnit omits the PII channels; UnitPii carries them', () => {
    const { whatsapp, email, ...stored } = VALID_UNIT
    const decodedStored = Schema.decodeUnknownSync(StoredUnit)(stored)
    expect('whatsapp' in decodedStored).toBe(false)
    const decodedPii = Schema.decodeUnknownSync(UnitPii)({ whatsapp, email })
    expect(decodedPii.whatsapp).toBe('5511999998888')
  })

  it('a new Unit is born informal (fiscal default)', () => {
    const decoded = Schema.decodeUnknownSync(Unit)(VALID_UNIT)
    expect(decoded.fiscal.kind).toBe('informal')
  })

  it('decodes the company fiscal variant (brief 0048) — CNPJ-14 + profile ride in StoredUnit', () => {
    const company = {
      ...VALID_UNIT,
      fiscal: {
        kind: 'company',
        taxId: '40148980000199',
        companyProfile: {
          taxId: '40148980000199',
          isMei: false,
          taxRegime: 'simples_nacional',
          primaryActivity: { code: '6201501', description: 'Software' },
          secondaryActivities: [],
          companySize: 'micro',
          legalNature: '2062',
          registrationStatus: 'ATIVA',
          shareCapital: 1000,
          activityStartedAt: '2020-01-01',
        },
        formalizedAt: '2026-06-18T00:00:00.000Z',
      },
    }
    const { whatsapp, email, ...stored } = company
    void whatsapp
    void email
    const decoded = Schema.decodeUnknownSync(StoredUnit)(stored)
    expect(decoded.fiscal.kind).toBe('company')
    if (decoded.fiscal.kind !== 'company') throw new Error('expected company')
    expect(decoded.fiscal.taxId).toBe('40148980000199')
  })

  it('rejects a company fiscal variant missing the CNPJ-14', () => {
    expect(() =>
      Schema.decodeUnknownSync(Unit)({ ...VALID_UNIT, fiscal: { kind: 'company' } }),
    ).toThrow()
  })
})

describe('dayHoursToRanges', () => {
  it('treats null (closed) as no ranges', () => {
    expect(dayHoursToRanges(null)).toEqual([])
  })

  it('wraps a single range', () => {
    expect(dayHoursToRanges({ open: '09:00', close: '18:00' })).toEqual([
      { open: '09:00', close: '18:00' },
    ])
  })

  it('flattens a multi-interval array (split shift)', () => {
    expect(
      dayHoursToRanges([
        { open: '09:00', close: '12:00' },
        { open: '13:00', close: '18:00' },
      ]),
    ).toEqual([
      { open: '09:00', close: '12:00' },
      { open: '13:00', close: '18:00' },
    ])
  })
})

describe('isAddressComplete', () => {
  const FULL: Address = {
    postalCode: '01001-000',
    state: 'SP',
    city: 'São Paulo',
    neighborhood: 'Sé',
    street: 'Praça da Sé',
    number: '100',
    complement: null,
  }

  it('is true for a fully filled address', () => {
    expect(isAddressComplete(FULL)).toBe(true)
  })

  it('is true without number/complement (legitimately optional)', () => {
    expect(isAddressComplete({ ...FULL, number: null, complement: null })).toBe(true)
  })

  it('is false for the all-empty zero-value (EMPTY_ADDRESS)', () => {
    expect(isAddressComplete(EMPTY_ADDRESS)).toBe(false)
  })

  it('is false when any required field is blank or whitespace-only', () => {
    expect(isAddressComplete({ ...FULL, postalCode: '' })).toBe(false)
    expect(isAddressComplete({ ...FULL, city: '   ' })).toBe(false)
    expect(isAddressComplete({ ...FULL, street: '' })).toBe(false)
  })
})
