import { describe, expect, it } from 'vitest'
import {
  normalizeServicePriceVisibility,
  resolveServiceForUnit,
  toPublicService,
  type Service,
} from './service'

function buildService(overrides: Partial<Service> = {}): Service {
  return {
    id: 's1',
    tenantId: 't1',
    name: 'Corte',
    category: null,
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 40 },
    requiredResources: [],
    active: true,
    publicVisible: false,
    priceVisibility: 'visible',
    unitIds: ['u1', 'u2'],
    unitOverrides: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveServiceForUnit', () => {
  it('returns base attributes when there are no overrides', () => {
    const r = resolveServiceForUnit(buildService(), 'u1')
    expect(r.priceCents).toBe(5000)
    expect(r.durationMinutes).toBe(30)
    expect(r.commission).toEqual({ kind: 'percentage', value: 40 })
  })

  it('applies a partial override (price only) and keeps base for the rest', () => {
    const s = buildService({ unitOverrides: { u2: { priceCents: 8000 } } })
    const r = resolveServiceForUnit(s, 'u2')
    expect(r.priceCents).toBe(8000)
    expect(r.durationMinutes).toBe(30)
    expect(r.commission).toEqual({ kind: 'percentage', value: 40 })
  })

  it('applies a full override (price + duration + commission)', () => {
    const s = buildService({
      unitOverrides: {
        u2: {
          priceCents: 9000,
          durationMinutes: 45,
          commission: { kind: 'fixed', value: 2000 },
        },
      },
    })
    const r = resolveServiceForUnit(s, 'u2')
    expect(r.priceCents).toBe(9000)
    expect(r.durationMinutes).toBe(45)
    expect(r.commission).toEqual({ kind: 'fixed', value: 2000 })
  })

  it('lets an override null out commission for a specific unit', () => {
    const s = buildService({ unitOverrides: { u2: { commission: null } } })
    const r = resolveServiceForUnit(s, 'u2')
    expect(r.commission).toBeNull()
  })

  it('falls back to base when the unit has no override entry', () => {
    const s = buildService({ unitOverrides: { u2: { priceCents: 9999 } } })
    const r = resolveServiceForUnit(s, 'u1')
    expect(r.priceCents).toBe(5000)
  })

  it('falls back to base when the unit is not in unitIds (defensive)', () => {
    const s = buildService({ unitOverrides: { other: { priceCents: 111 } } })
    const r = resolveServiceForUnit(s, 'unknown')
    expect(r.priceCents).toBe(5000)
    expect(r.durationMinutes).toBe(30)
  })
})

describe('normalizeServicePriceVisibility', () => {
  it("returns 'visible' by default (undefined, null, malformed)", () => {
    expect(normalizeServicePriceVisibility(undefined)).toBe('visible')
    expect(normalizeServicePriceVisibility(null)).toBe('visible')
    expect(normalizeServicePriceVisibility('garbage')).toBe('visible')
    expect(normalizeServicePriceVisibility('visible')).toBe('visible')
  })

  it("returns 'on_request' when the field carries that literal", () => {
    expect(normalizeServicePriceVisibility('on_request')).toBe('on_request')
  })
})

describe('toPublicService', () => {
  it('strips commission, unitOverrides, active, publicVisible, tenantId', () => {
    const s = buildService({
      unitOverrides: { u1: { priceCents: 7000 } },
      commission: { kind: 'fixed', value: 999 },
    })
    const pub = toPublicService(s, 'u1')
    // Field-level allowlist: only public projection keys allowed.
    expect(Object.keys(pub).sort()).toEqual(
      ['category', 'durationMinutes', 'id', 'name', 'priceCents', 'requiredResources'].sort(),
    )
    expect(pub.priceCents).toBe(7000)
  })

  it('resolves per-unit price/duration via resolveServiceForUnit', () => {
    const s = buildService({
      unitOverrides: { u2: { priceCents: 9000, durationMinutes: 45 } },
    })
    const pub = toPublicService(s, 'u2')
    expect(pub.priceCents).toBe(9000)
    expect(pub.durationMinutes).toBe(45)
  })

  it("renders priceCents=null when priceVisibility='on_request'", () => {
    const s = buildService({ priceVisibility: 'on_request' })
    const pub = toPublicService(s, 'u1')
    expect(pub.priceCents).toBeNull()
    expect(pub.durationMinutes).toBe(30)
  })

  it('treats legacy docs without priceVisibility as visible', () => {
    const s = buildService()
    // Simulate legacy doc missing the field — read-side normalizer kicks in.
    // @ts-expect-error — testing legacy doc shape
    delete s.priceVisibility
    const pub = toPublicService(s, 'u1')
    expect(pub.priceCents).toBe(5000)
  })
})
