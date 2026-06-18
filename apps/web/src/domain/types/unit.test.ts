import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  dayHoursToRanges,
  isReservedUnitSlug,
  isUnitBookable,
  isValidUnitSlug,
  slugifyUnitName,
  StoredUnit,
  Unit,
  UnitPii,
  unitUsesAgenda,
} from './unit'

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

// `hoursMode` is REQUIRED in the v2 schema (PRD Identidade) — these derivations
// are the payoff of forcing every unit to declare a mode: "uses agenda" and
// "is bookable" are computed from config, with no manual publish flag.
describe('unitUsesAgenda', () => {
  it('is true only for the appointment mode', () => {
    expect(unitUsesAgenda({ hoursMode: 'appointment' })).toBe(true)
    expect(unitUsesAgenda({ hoursMode: 'fixed' })).toBe(false)
    expect(unitUsesAgenda({ hoursMode: 'always_open' })).toBe(false)
  })
})

describe('isUnitBookable', () => {
  const hours = {
    monday: { open: '09:00', close: '18:00' },
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  }

  it('is bookable when the unit uses the agenda', () => {
    expect(isUnitBookable({ hoursMode: 'appointment', businessHours: hours })).toBe(true)
  })

  it('is not bookable for walk-in / always-open modes', () => {
    expect(isUnitBookable({ hoursMode: 'fixed', businessHours: hours })).toBe(false)
    expect(isUnitBookable({ hoursMode: 'always_open', businessHours: hours })).toBe(false)
  })
})

// Schema decode of the v2 Unit: `address`/`businessHours`/`hoursMode` are now
// REQUIRED (no longer NullOr/optional) — these round-trips lock the contract and
// exercise the DayHours union (single range / multi-interval array / null) plus
// the Address NullOr fields.
describe('Unit / StoredUnit schema (v2 — required address/hours/mode)', () => {
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
    hoursMode: 'fixed' as const,
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
    archivedAt: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  }

  it('decodes a full Unit with every DayHours variant', () => {
    const decoded = Schema.decodeUnknownSync(Unit)(VALID_UNIT)
    expect(decoded.address.street).toBe('Av. Paulista')
    expect(decoded.hoursMode).toBe('fixed')
    expect(decoded.businessHours.wednesday).toBeNull()
  })

  it('rejects a Unit with a null address (REQUIRED in v2)', () => {
    expect(() => Schema.decodeUnknownSync(Unit)({ ...VALID_UNIT, address: null })).toThrow()
  })

  it('rejects a Unit with a null businessHours (REQUIRED in v2)', () => {
    expect(() => Schema.decodeUnknownSync(Unit)({ ...VALID_UNIT, businessHours: null })).toThrow()
  })

  it('StoredUnit omits the PII channels; UnitPii carries them', () => {
    const { whatsapp, email, ...stored } = VALID_UNIT
    const decodedStored = Schema.decodeUnknownSync(StoredUnit)(stored)
    expect('whatsapp' in decodedStored).toBe(false)
    const decodedPii = Schema.decodeUnknownSync(UnitPii)({ whatsapp, email })
    expect(decodedPii.whatsapp).toBe('5511999998888')
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
