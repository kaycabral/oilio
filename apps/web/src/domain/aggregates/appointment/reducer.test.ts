import { describe, expect, it } from 'vitest'

import type { EventMeta } from '@/domain/effect/event-store'
import { applyAppointmentEvent } from './reducer'
import { INITIAL_APPOINTMENT_STATE, type AppointmentState } from './types'

function meta(version: number, timestamp = '2026-06-01T10:00:00.000Z'): EventMeta {
  return { version, timestamp, actorId: 'user-1', schemaVersion: 1 }
}

const CREATED_DATA: Partial<AppointmentState> = {
  id: 'a1',
  tenantId: 't1',
  unitId: 'u1',
  professionalId: 'p1',
  customerId: 'c1',
  serviceId: 'svc1',
  startAt: '2026-06-10T13:00:00.000Z',
  endAt: '2026-06-10T13:30:00.000Z',
  servicePriceCentsSnapshot: 5000,
  serviceDurationMinutesSnapshot: 30,
  customerUserId: 'u-c1',
}

// Fold a created event from the empty seed so later events have a real state.
function created(): AppointmentState {
  return applyAppointmentEvent(
    INITIAL_APPOINTMENT_STATE,
    { _tag: 'appointment.created', data: CREATED_DATA },
    meta(1),
  )
}

describe('applyAppointmentEvent', () => {
  it('created applies the payload data and seeds status=scheduled + timestamps', () => {
    const state = created()
    expect(state).toMatchObject({ ...CREATED_DATA, status: 'scheduled' })
    expect(state.createdAt).toBe('2026-06-01T10:00:00.000Z')
    expect(state.updatedAt).toBe('2026-06-01T10:00:00.000Z')
    expect(state._version).toBe(1)
  })

  it('every event advances _version and stamps updatedAt from the meta', () => {
    const state = applyAppointmentEvent(
      created(),
      { _tag: 'appointment.completed' },
      meta(7, '2026-06-02T08:00:00.000Z'),
    )
    expect(state._version).toBe(7)
    expect(state.updatedAt).toBe('2026-06-02T08:00:00.000Z')
    // createdAt is not touched by a non-created event.
    expect(state.createdAt).toBe('2026-06-01T10:00:00.000Z')
  })

  it('updated merges the changes onto the prior state', () => {
    const state = applyAppointmentEvent(
      created(),
      { _tag: 'appointment.updated', changes: { serviceId: 'svc2', startAt: 'X' } },
      meta(2),
    )
    expect(state.serviceId).toBe('svc2')
    expect(state.startAt).toBe('X')
    expect(state.status).toBe('scheduled')
  })

  it('completed sets status=completed', () => {
    expect(
      applyAppointmentEvent(created(), { _tag: 'appointment.completed' }, meta(2)).status,
    ).toBe('completed')
  })

  it('cancelled sets status + cancellation metadata', () => {
    const state = applyAppointmentEvent(
      created(),
      {
        _tag: 'appointment.cancelled',
        cancelledAt: '2026-06-05T09:00:00.000Z',
        cancelledBy: 'customer',
        noticeMinutes: 120,
      },
      meta(2),
    )
    expect(state).toMatchObject({
      status: 'cancelled',
      cancelledAt: '2026-06-05T09:00:00.000Z',
      cancelledBy: 'customer',
      cancelledNoticeMinutes: 120,
    })
  })

  it('no_show sets status + marker metadata', () => {
    const state = applyAppointmentEvent(
      created(),
      {
        _tag: 'appointment.no_show',
        markedAt: '2026-06-10T14:00:00.000Z',
        markedBy: 'user-9',
      },
      meta(2),
    )
    expect(state).toMatchObject({
      status: 'no_show',
      noShowMarkedAt: '2026-06-10T14:00:00.000Z',
      noShowMarkedBy: 'user-9',
    })
  })

  it('no_show_reverted returns status to scheduled', () => {
    const noShow = applyAppointmentEvent(
      created(),
      { _tag: 'appointment.no_show', markedAt: 'x', markedBy: 'y' },
      meta(2),
    )
    expect(
      applyAppointmentEvent(noShow, { _tag: 'appointment.no_show_reverted' }, meta(3)).status,
    ).toBe('scheduled')
  })

  it('rescheduled moves the interval + records reschedule metadata', () => {
    const state = applyAppointmentEvent(
      created(),
      {
        _tag: 'appointment.rescheduled',
        newStartAt: '2026-06-11T13:00:00.000Z',
        newEndAt: '2026-06-11T13:30:00.000Z',
        rescheduledAt: '2026-06-09T10:00:00.000Z',
        rescheduledBy: 'staff',
        noticeMinutes: 1440,
      },
      meta(2),
    )
    expect(state).toMatchObject({
      startAt: '2026-06-11T13:00:00.000Z',
      endAt: '2026-06-11T13:30:00.000Z',
      rescheduledAt: '2026-06-09T10:00:00.000Z',
      rescheduledBy: 'staff',
      rescheduledNoticeMinutes: 1440,
    })
    expect(state.status).toBe('scheduled')
  })
})
