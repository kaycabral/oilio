import { describe, expect, it } from 'vitest'
import type { Appointment } from '../types/appointment'
import type { Professional } from '../types/professional'
import type { Service } from '../types/service'
import type { BusinessHours } from '../types/unit'
import {
  computeAvailabilityForDay,
  groupAvailabilityByLocalTime,
  type AvailabilitySlot,
} from './availability'

const BR = 'America/Sao_Paulo'
const UNIT_ID = 'u1'

function svc(o: Partial<Service> = {}): Service {
  return {
    id: 'svc1',
    tenantId: 't1',
    name: 'Corte',
    category: null,
    durationMinutes: 30,
    priceCents: 5000,
    commission: null,
    requiredResources: [],
    active: true,
    publicVisible: true,
    priceVisibility: 'visible',
    unitIds: [UNIT_ID],
    unitOverrides: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  }
}

function pro(o: Partial<Professional> = {}): Professional {
  return {
    id: 'p1',
    tenantId: 't1',
    userId: 'u-pro1',
    name: 'Alice',
    whatsapp: '5511900000000',
    email: null,
    taxIdentity: null,
    operationalStatus: 'operational',
    defaultCommission: null,
    unitIds: [UNIT_ID],
    serviceIds: ['svc1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  }
}

function bh(opts: Partial<BusinessHours> = {}): BusinessHours {
  const range = { open: '09:00', close: '12:00' }
  return {
    monday: range,
    tuesday: range,
    wednesday: range,
    thursday: range,
    friday: range,
    saturday: null,
    sunday: null,
    ...opts,
  }
}

function appt(o: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    tenantId: 't1',
    unitId: UNIT_ID,
    professionalId: 'p1',
    customerId: 'c1',
    serviceId: 'svc1',
    startAt: '2026-08-17T13:00:00.000Z',
    endAt: '2026-08-17T13:30:00.000Z',
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'u1',
    professionalUserId: null,
    createdAt: '',
    updatedAt: '',
    ...o,
  }
}

// 2026-08-17 is a Monday. Business hours 09:00–12:00 BR = 12:00–15:00 UTC.
// Slots at 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 BR with 30min slotMinutes.
// Last slot start = 11:30 BR (ends at 12:00, closing time).

describe('computeAvailabilityForDay', () => {
  it('returns the full grid when there are no conflicts', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-08-17T12:00:00.000Z',
      '2026-08-17T12:30:00.000Z',
      '2026-08-17T13:00:00.000Z',
      '2026-08-17T13:30:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-17T14:30:00.000Z',
    ])
  })

  it('returns empty when the resolved service has non-positive duration', () => {
    const slots = computeAvailabilityForDay({
      service: svc({ durationMinutes: 0 }),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots).toEqual([])
  })

  it('returns empty when the service is longer than the open window', () => {
    // 09:00–12:00 = 180min window; a 240min service never fits.
    const slots = computeAvailabilityForDay({
      service: svc({ durationMinutes: 240 }),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots).toEqual([])
  })

  it('drops slots overlapping a scheduled appointment', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      // 10:00–10:30 BR busy.
      appointments: [
        appt({ startAt: '2026-08-17T13:00:00.000Z', endAt: '2026-08-17T13:30:00.000Z' }),
      ],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-08-17T12:00:00.000Z',
      '2026-08-17T12:30:00.000Z',
      // 13:00 dropped (overlap).
      '2026-08-17T13:30:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-17T14:30:00.000Z',
    ])
  })

  it('ignores cancelled appointments', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [
        appt({
          status: 'cancelled',
          startAt: '2026-08-17T13:00:00.000Z',
          endAt: '2026-08-17T13:30:00.000Z',
        }),
      ],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots.some((s) => s.startAt === '2026-08-17T13:00:00.000Z')).toBe(true)
  })

  it('drops slots overlapping a block (unit-wide or pro-specific)', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      // Block 10:00–11:00 BR for this pro.
      blockSegments: [
        {
          blockId: 'b1',
          professionalId: 'p1',
          reason: 'Almoço',
          startMin: 10 * 60,
          endMin: 11 * 60,
        },
      ],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    const localHs = slots.map((s) => s.startAt)
    expect(localHs).not.toContain('2026-08-17T13:00:00.000Z')
    expect(localHs).not.toContain('2026-08-17T13:30:00.000Z')
  })

  it('respects per-unit duration via resolveServiceForUnit', () => {
    const longer = svc({ unitOverrides: { [UNIT_ID]: { durationMinutes: 60 } } })
    const slots = computeAvailabilityForDay({
      service: longer,
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-08-17T12:00:00.000Z',
      '2026-08-17T12:30:00.000Z',
      '2026-08-17T13:00:00.000Z',
      '2026-08-17T13:30:00.000Z',
      '2026-08-17T14:00:00.000Z',
      // 11:30 BR is now skipped — service ends at 12:30, past closing.
    ])
  })

  it('returns empty when the unit is closed on that weekday', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh({ monday: null }),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots).toEqual([])
  })

  it('drops slots in the past', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      // Now = 10:15 BR. 09:00, 09:30, 10:00 are past.
      nowMs: new Date('2026-08-17T13:15:00.000Z').getTime(),
    })
    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-08-17T13:30:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-17T14:30:00.000Z',
    ])
  })

  it('filters out professionals who do not execute the service', () => {
    const notLinked = pro({ id: 'p2', name: 'Bob', serviceIds: [] })
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro(), notLinked],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    const ids = new Set(slots.map((s) => s.professionalId))
    expect(ids.has('p1')).toBe(true)
    expect(ids.has('p2')).toBe(false)
  })

  it('emits one slot per professional + start', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro(), pro({ id: 'p2', name: 'Bob' })],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    // 6 slots × 2 pros = 12.
    expect(slots).toHaveLength(12)
  })
})

// Boundary cases that pin the exact comparison operators and predicates the
// broader tests above leave free (mutation burndown). All use the Monday
// 2026-08-17, 09:00–12:00 BR window (= 12:00–15:00 UTC).
describe('computeAvailabilityForDay — mutation boundaries', () => {
  const FAR_PAST = new Date('2026-08-15T00:00:00.000Z').getTime()
  function run(overrides: Partial<Parameters<typeof computeAvailabilityForDay>[0]>) {
    return computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: FAR_PAST,
      ...overrides,
    }).map((s) => s.startAt)
  }

  it('keeps the single slot when the service exactly fills the window (lastStartMin == openMin)', () => {
    // 09:00–12:00 = 180min; a 180min service fits exactly once, at 09:00.
    expect(run({ service: svc({ durationMinutes: 180 }), slotMinutes: 180 })).toEqual([
      '2026-08-17T12:00:00.000Z',
    ])
  })

  it('excludes ineligible professionals (incomplete, off-unit) but keeps the eligible one', () => {
    const ids = new Set(
      computeAvailabilityForDay({
        service: svc(),
        unitId: UNIT_ID,
        professionals: [
          pro(),
          pro({ id: 'p2', name: 'Incomplete', operationalStatus: 'incomplete' }),
          pro({ id: 'p3', name: 'OffUnit', unitIds: ['other-unit'] }),
        ],
        unitBusinessHours: bh(),
        appointments: [],
        blockSegments: [],
        date: '2026-08-17',
        slotMinutes: 30,
        timezone: BR,
        nowMs: FAR_PAST,
      }).map((s) => s.professionalId),
    )
    expect([...ids]).toEqual(['p1'])
  })

  it('keeps the slot at exactly nowMs (past cutoff is strict <)', () => {
    // First slot is 09:00 BR = 12:00 UTC. now == that instant → slot kept.
    const slots = run({ nowMs: new Date('2026-08-17T12:00:00.000Z').getTime() })
    expect(slots[0]).toBe('2026-08-17T12:00:00.000Z')
  })

  it('ignores a block owned by a different professional, applies a unit-wide (null) block', () => {
    // Block 09:00–12:00 for someone else → must NOT touch p1.
    expect(
      run({
        blockSegments: [
          { blockId: 'bx', professionalId: 'other-pro', reason: 'x', startMin: 540, endMin: 720 },
        ],
      }),
    ).toHaveLength(6)
    // Same span as a unit-wide block → blocks every p1 slot.
    expect(
      run({
        blockSegments: [
          { blockId: 'b0', professionalId: null, reason: 'Feriado', startMin: 540, endMin: 720 },
        ],
      }),
    ).toEqual([])
  })

  it('treats block/slot boundaries as half-open (touching edges do not overlap)', () => {
    // Block 09:30–10:00 (570–600). Slot 09:00 ends at 09:30 (touch → free);
    // slot 09:30 overlaps (gone); slot 10:00 starts at block end (touch → free).
    const slots = run({
      blockSegments: [
        { blockId: 'b1', professionalId: 'p1', reason: 'Café', startMin: 570, endMin: 600 },
      ],
    })
    expect(slots).toContain('2026-08-17T12:00:00.000Z')
    expect(slots).not.toContain('2026-08-17T12:30:00.000Z')
    expect(slots).toContain('2026-08-17T13:00:00.000Z')
  })

  it('a cancelled appointment never blocks; a scheduled one at the same time does', () => {
    const at13 = { startAt: '2026-08-17T13:00:00.000Z', endAt: '2026-08-17T13:30:00.000Z' }
    expect(run({ appointments: [appt({ status: 'cancelled', ...at13 })] })).toContain(
      '2026-08-17T13:00:00.000Z',
    )
    expect(run({ appointments: [appt({ status: 'scheduled', ...at13 })] })).not.toContain(
      '2026-08-17T13:00:00.000Z',
    )
  })

  it("does not let another professional's appointment block this one's slot", () => {
    // p1 has a free grid; p2 is booked 10:00–10:30. p1's 10:00 slot must stay.
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      professionals: [pro()],
      unitBusinessHours: bh(),
      appointments: [
        appt({
          id: 'a-p2',
          professionalId: 'p2',
          status: 'scheduled',
          startAt: '2026-08-17T13:00:00.000Z',
          endAt: '2026-08-17T13:30:00.000Z',
        }),
      ],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: FAR_PAST,
    })
    expect(slots.map((s) => s.startAt)).toContain('2026-08-17T13:00:00.000Z')
  })
})

describe('groupAvailabilityByLocalTime', () => {
  it('groups by tenant-local HH:mm and sorts ascending', () => {
    const slots: AvailabilitySlot[] = [
      { professionalId: 'p1', startAt: '2026-08-17T13:30:00.000Z' },
      { professionalId: 'p2', startAt: '2026-08-17T13:30:00.000Z' },
      { professionalId: 'p1', startAt: '2026-08-17T12:00:00.000Z' },
    ]
    const rows = groupAvailabilityByLocalTime(slots, BR)
    expect(rows.map((r) => r.localHHmm)).toEqual(['09:00', '10:30'])
    expect(rows[1]!.slots.map((s) => s.professionalId)).toEqual(['p1', 'p2'])
  })
})
