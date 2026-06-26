import type { Appointment } from '@/domain'
import { describe, expect, it } from 'vitest'
import { evaluateBookingLimits } from './booking-limits'

const TZ = 'America/Sao_Paulo'
const NOW = new Date('2026-06-10T12:00:00.000Z')

// Full typed factory (no cast) — overrides on top of a valid base, matching the
// repo's fixture pattern. The rules only read id/startAt/status; the rest is
// filler to satisfy the Appointment contract.
function appt(over: Partial<Appointment> & { id: string; startAt: string }): Appointment {
  const base: Appointment = {
    id: over.id,
    orgId: 't1',
    unitId: 'u1',
    professionalId: 'p1',
    customerId: 'c1',
    serviceId: 's1',
    startAt: over.startAt,
    endAt: over.startAt,
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'cu1',
    professionalUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return { ...base, ...over }
}

describe('evaluateBookingLimits', () => {
  it('returns ok when no limits are configured', () => {
    const r = evaluateBookingLimits({
      appointments: [],
      limits: {},
      proposedStartAt: '2026-06-10T15:00:00.000Z',
      orgTimezone: TZ,
      now: NOW,
    })
    expect(r).toEqual({ kind: 'ok' })
  })

  it('flags reschedule-required at maxPerDay, anchored on the earliest same-day appt', () => {
    const proposed = '2026-06-10T20:00:00.000Z'
    const r = evaluateBookingLimits({
      appointments: [
        appt({ id: 'late', startAt: '2026-06-10T21:00:00.000Z' }),
        appt({ id: 'early', startAt: '2026-06-10T13:00:00.000Z' }),
      ],
      limits: { maxPerDay: 1 },
      proposedStartAt: proposed,
      orgTimezone: TZ,
      now: NOW,
    })
    expect(r).toEqual({
      kind: 'reschedule-required',
      existingAppointment: { id: 'early', startAt: '2026-06-10T13:00:00.000Z' },
      maxPerDay: 1,
    })
  })

  it('ignores cancelled/no_show appts in the daily count', () => {
    const r = evaluateBookingLimits({
      appointments: [appt({ id: 'x', startAt: '2026-06-10T13:00:00.000Z', status: 'cancelled' })],
      limits: { maxPerDay: 1 },
      proposedStartAt: '2026-06-10T20:00:00.000Z',
      orgTimezone: TZ,
      now: NOW,
    })
    expect(r).toEqual({ kind: 'ok' })
  })

  it('blocks on requireCompleteBeforeNext when a future scheduled appt exists', () => {
    const r = evaluateBookingLimits({
      appointments: [appt({ id: 'fut', startAt: '2026-06-12T10:00:00.000Z' })],
      limits: { requireCompleteBeforeNext: true },
      proposedStartAt: '2026-06-15T10:00:00.000Z',
      orgTimezone: TZ,
      now: NOW,
    })
    expect(r.kind).toBe('blocked')
    if (r.kind === 'blocked') expect(r.rule).toBe('requireCompleteBeforeNext')
  })

  it('blocks on maxConcurrent once future scheduled count hits the cap', () => {
    const r = evaluateBookingLimits({
      appointments: [
        appt({ id: 'a', startAt: '2026-06-12T10:00:00.000Z' }),
        appt({ id: 'b', startAt: '2026-06-13T10:00:00.000Z' }),
      ],
      limits: { maxConcurrent: 2 },
      proposedStartAt: '2026-06-15T10:00:00.000Z',
      orgTimezone: TZ,
      now: NOW,
    })
    expect(r.kind).toBe('blocked')
    if (r.kind === 'blocked') expect(r.rule).toBe('maxConcurrent')
  })
})
