import { describe, expect, it } from 'vitest'
import type { Appointment } from '../types/appointment'
import type { CatalogServiceItem } from '../types/catalog-item'
import type { MemberOperation } from '../types/member-operation'
import type { BusinessHours } from '../types/unit'
import {
  computeAvailabilityForDay,
  groupAvailabilityByLocalTime,
  type AvailabilitySlot,
} from './availability'

const BR = 'America/Sao_Paulo'
const UNIT_ID = 'u1'

function svc(o: Partial<CatalogServiceItem> = {}): CatalogServiceItem {
  return {
    id: 'svc1',
    orgId: 't1',
    kind: 'service',
    name: 'Corte',
    categoryId: null,
    durationMinutes: 30,
    priceCents: 5000,
    commission: null,
    requiredResources: [],
    active: true,
    publicVisible: true,
    priceVisibility: 'visible',
    unitIds: [UNIT_ID],
    unitOverrides: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  }
}

function pro(o: Partial<MemberOperation> = {}): MemberOperation {
  return {
    id: 'p1',
    orgId: 't1',
    userId: 'u-pro1',
    name: 'Alice',
    mobile: '5511900000000',
    email: null,
    taxIdentity: null,
    operationalStatus: 'operational',
    defaultCommission: null,
    unitIds: [UNIT_ID],
    catalogServiceIds: ['svc1'],
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
    orgId: 't1',
    unitId: UNIT_ID,
    memberOperationId: 'p1',
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
    memberOperatorUserId: null,
    attribution: null,
    createdAt: '',
    updatedAt: '',
    ...o,
  }
}

describe('computeAvailabilityForDay', () => {
  it('returns the full grid when there are no conflicts', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro()],
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
      memberOperations: [pro()],
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
    const slots = computeAvailabilityForDay({
      service: svc({ durationMinutes: 240 }),
      unitId: UNIT_ID,
      memberOperations: [pro()],
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
      memberOperations: [pro()],
      unitBusinessHours: bh(),
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
      '2026-08-17T13:30:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-17T14:30:00.000Z',
    ])
  })

  it('ignores cancelled appointments', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro()],
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
      memberOperations: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [
        {
          blockId: 'b1',
          memberOperationId: 'p1',
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

  it('respects per-unit duration via resolveCatalogItemForUnit', () => {
    const longer = svc({ unitOverrides: { [UNIT_ID]: { durationMinutes: 60 } } })
    const slots = computeAvailabilityForDay({
      service: longer,
      unitId: UNIT_ID,
      memberOperations: [pro()],
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
    ])
  })

  it('returns empty when the unit is closed on that weekday', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro()],
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
      memberOperations: [pro()],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-17T13:15:00.000Z').getTime(),
    })
    expect(slots.map((s) => s.startAt)).toEqual([
      '2026-08-17T13:30:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-17T14:30:00.000Z',
    ])
  })

  it('filters out memberOperations who do not execute the service', () => {
    const notLinked = pro({ id: 'p2', name: 'Bob', catalogServiceIds: [] })
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro(), notLinked],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    const ids = new Set(slots.map((s) => s.memberOperationId))
    expect(ids.has('p1')).toBe(true)
    expect(ids.has('p2')).toBe(false)
  })

  it('emits one slot per memberOperation + start', () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro(), pro({ id: 'p2', name: 'Bob' })],
      unitBusinessHours: bh(),
      appointments: [],
      blockSegments: [],
      date: '2026-08-17',
      slotMinutes: 30,
      timezone: BR,
      nowMs: new Date('2026-08-15T00:00:00.000Z').getTime(),
    })
    expect(slots).toHaveLength(12)
  })
})

describe('computeAvailabilityForDay — mutation boundaries', () => {
  const FAR_PAST = new Date('2026-08-15T00:00:00.000Z').getTime()
  function run(overrides: Partial<Parameters<typeof computeAvailabilityForDay>[0]>) {
    return computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro()],
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
    expect(run({ service: svc({ durationMinutes: 180 }), slotMinutes: 180 })).toEqual([
      '2026-08-17T12:00:00.000Z',
    ])
  })

  it('excludes ineligible memberOperations (incomplete, off-unit) but keeps the eligible one', () => {
    const ids = new Set(
      computeAvailabilityForDay({
        service: svc(),
        unitId: UNIT_ID,
        memberOperations: [
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
      }).map((s) => s.memberOperationId),
    )
    expect([...ids]).toEqual(['p1'])
  })

  it('keeps the slot at exactly nowMs (past cutoff is strict <)', () => {
    const slots = run({ nowMs: new Date('2026-08-17T12:00:00.000Z').getTime() })
    expect(slots[0]).toBe('2026-08-17T12:00:00.000Z')
  })

  it('ignores a block owned by a different memberOperation, applies a unit-wide (null) block', () => {
    expect(
      run({
        blockSegments: [
          {
            blockId: 'bx',
            memberOperationId: 'other-pro',
            reason: 'x',
            startMin: 540,
            endMin: 720,
          },
        ],
      }),
    ).toHaveLength(6)
    expect(
      run({
        blockSegments: [
          { blockId: 'b0', memberOperationId: null, reason: 'Feriado', startMin: 540, endMin: 720 },
        ],
      }),
    ).toEqual([])
  })

  it('treats block/slot boundaries as half-open (touching edges do not overlap)', () => {
    const slots = run({
      blockSegments: [
        { blockId: 'b1', memberOperationId: 'p1', reason: 'Café', startMin: 570, endMin: 600 },
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

  it("does not let another memberOperation's appointment block this one's slot", () => {
    const slots = computeAvailabilityForDay({
      service: svc(),
      unitId: UNIT_ID,
      memberOperations: [pro()],
      unitBusinessHours: bh(),
      appointments: [
        appt({
          id: 'a-p2',
          memberOperationId: 'p2',
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
  it('groups by org-local HH:mm and sorts ascending', () => {
    const slots: AvailabilitySlot[] = [
      { memberOperationId: 'p1', startAt: '2026-08-17T13:30:00.000Z' },
      { memberOperationId: 'p2', startAt: '2026-08-17T13:30:00.000Z' },
      { memberOperationId: 'p1', startAt: '2026-08-17T12:00:00.000Z' },
    ]
    const rows = groupAvailabilityByLocalTime(slots, BR)
    expect(rows.map((r) => r.localHHmm)).toEqual(['09:00', '10:30'])
    expect(rows[1]!.slots.map((s) => s.memberOperationId)).toEqual(['p1', 'p2'])
  })
})
