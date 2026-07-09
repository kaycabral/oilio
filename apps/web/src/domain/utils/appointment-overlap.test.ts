import { describe, expect, it } from 'vitest'
import type { Appointment } from '../types/appointment'
import type { BlockSegment } from './agenda-blocks'
import { findAppointmentConflicts, intervalsOverlap } from './appointment-overlap'

const TZ = 'America/Sao_Paulo'
const DATE = '2026-05-14'

function appt(
  overrides: Partial<Appointment> & Pick<Appointment, 'startAt' | 'endAt'>,
): Appointment {
  return {
    id: 'a1',
    orgId: 't1',
    unitId: 'u1',
    memberOperationId: 'p1',
    customerId: 'c1',
    serviceId: 's1',
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'u1',
    memberOperatorUserId: null,
    attribution: null,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    ...overrides,
  }
}

describe('intervalsOverlap', () => {
  it('returns true for partially overlapping intervals', () => {
    expect(
      intervalsOverlap(
        { startAt: '2026-05-14T13:00:00.000Z', endAt: '2026-05-14T14:00:00.000Z' },
        { startAt: '2026-05-14T13:30:00.000Z', endAt: '2026-05-14T14:30:00.000Z' },
      ),
    ).toBe(true)
  })

  it('returns false for back-to-back intervals (shared boundary)', () => {
    expect(
      intervalsOverlap(
        { startAt: '2026-05-14T13:00:00.000Z', endAt: '2026-05-14T14:00:00.000Z' },
        { startAt: '2026-05-14T14:00:00.000Z', endAt: '2026-05-14T15:00:00.000Z' },
      ),
    ).toBe(false)
  })

  it('returns false for fully disjoint intervals', () => {
    expect(
      intervalsOverlap(
        { startAt: '2026-05-14T13:00:00.000Z', endAt: '2026-05-14T14:00:00.000Z' },
        { startAt: '2026-05-14T15:00:00.000Z', endAt: '2026-05-14T16:00:00.000Z' },
      ),
    ).toBe(false)
  })

  it('returns true when one fully contains the other', () => {
    expect(
      intervalsOverlap(
        { startAt: '2026-05-14T13:00:00.000Z', endAt: '2026-05-14T17:00:00.000Z' },
        { startAt: '2026-05-14T14:00:00.000Z', endAt: '2026-05-14T15:00:00.000Z' },
      ),
    ).toBe(true)
  })
})

describe('findAppointmentConflicts', () => {
  it('finds appointment overlap for same memberOperation', () => {
    const existing = [
      appt({
        id: 'existing-1',
        startAt: '2026-05-14T13:00:00.000Z',
        endAt: '2026-05-14T14:00:00.000Z',
      }),
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T13:30:00.000Z', endAt: '2026-05-14T14:30:00.000Z' },
      memberOperationId: 'p1',
      existing,
      blockSegments: [],
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([{ kind: 'appointment', appointmentId: 'existing-1' }])
  })

  it('ignores appointment on different memberOperation', () => {
    const existing = [
      appt({
        id: 'existing-1',
        memberOperationId: 'p2',
        startAt: '2026-05-14T13:00:00.000Z',
        endAt: '2026-05-14T14:00:00.000Z',
      }),
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T13:30:00.000Z', endAt: '2026-05-14T14:30:00.000Z' },
      memberOperationId: 'p1',
      existing,
      blockSegments: [],
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([])
  })

  it('ignores cancelled appointments', () => {
    const existing = [
      appt({
        id: 'existing-1',
        status: 'cancelled',
        startAt: '2026-05-14T13:00:00.000Z',
        endAt: '2026-05-14T14:00:00.000Z',
      }),
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T13:30:00.000Z', endAt: '2026-05-14T14:30:00.000Z' },
      memberOperationId: 'p1',
      existing,
      blockSegments: [],
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([])
  })

  it('skips the excluded appointment id (edit flow)', () => {
    const existing = [
      appt({
        id: 'existing-1',
        startAt: '2026-05-14T13:00:00.000Z',
        endAt: '2026-05-14T14:00:00.000Z',
      }),
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T13:30:00.000Z', endAt: '2026-05-14T14:30:00.000Z' },
      memberOperationId: 'p1',
      existing,
      blockSegments: [],
      date: DATE,
      tz: TZ,
      excludeAppointmentId: 'existing-1',
    })
    expect(conflicts).toEqual([])
  })

  it('detects unit-wide block conflict', () => {
    const blocks: BlockSegment[] = [
      {
        blockId: 'b1',
        memberOperationId: null,
        reason: 'Almoço',
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T15:30:00.000Z', endAt: '2026-05-14T16:00:00.000Z' },
      memberOperationId: 'p1',
      existing: [],
      blockSegments: blocks,
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([{ kind: 'block', blockId: 'b1', reason: 'Almoço' }])
  })

  it('ignores block scoped to other memberOperation', () => {
    const blocks: BlockSegment[] = [
      {
        blockId: 'b1',
        memberOperationId: 'p2',
        reason: 'Almoço',
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T15:30:00.000Z', endAt: '2026-05-14T16:00:00.000Z' },
      memberOperationId: 'p1',
      existing: [],
      blockSegments: blocks,
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([])
  })

  it('back-to-back with block boundary does not conflict', () => {
    const blocks: BlockSegment[] = [
      {
        blockId: 'b1',
        memberOperationId: null,
        reason: 'Almoço',
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T16:00:00.000Z', endAt: '2026-05-14T17:00:00.000Z' },
      memberOperationId: 'p1',
      existing: [],
      blockSegments: blocks,
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([])
  })

  it('skips block check when the proposed interval starts on a different day', () => {
    const blocks: BlockSegment[] = [
      {
        blockId: 'b1',
        memberOperationId: null,
        reason: 'Almoço',
        startMin: 12 * 60,
        endMin: 13 * 60,
      },
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-15T15:30:00.000Z', endAt: '2026-05-15T16:00:00.000Z' },
      memberOperationId: 'p1',
      existing: [],
      blockSegments: blocks,
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([])
  })

  it('clips the proposed interval at midnight when it crosses into the next day', () => {
    const blocks: BlockSegment[] = [
      {
        blockId: 'b1',
        memberOperationId: null,
        reason: 'Fechado',
        startMin: 23 * 60,
        endMin: 24 * 60,
      },
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-15T02:30:00.000Z', endAt: '2026-05-15T03:30:00.000Z' },
      memberOperationId: 'p1',
      existing: [],
      blockSegments: blocks,
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toEqual([{ kind: 'block', blockId: 'b1', reason: 'Fechado' }])
  })

  it('returns all conflicts when multiple intersect', () => {
    const existing = [
      appt({
        id: 'existing-1',
        startAt: '2026-05-14T13:30:00.000Z',
        endAt: '2026-05-14T14:30:00.000Z',
      }),
    ]
    const blocks: BlockSegment[] = [
      {
        blockId: 'b1',
        memberOperationId: null,
        reason: 'Almoço',
        startMin: 10 * 60 + 30,
        endMin: 11 * 60,
      },
    ]
    const conflicts = findAppointmentConflicts({
      proposed: { startAt: '2026-05-14T13:00:00.000Z', endAt: '2026-05-14T14:30:00.000Z' },
      memberOperationId: 'p1',
      existing,
      blockSegments: blocks,
      date: DATE,
      tz: TZ,
    })
    expect(conflicts).toHaveLength(2)
    expect(conflicts.some((c) => c.kind === 'appointment')).toBe(true)
    expect(conflicts.some((c) => c.kind === 'block')).toBe(true)
  })
})
