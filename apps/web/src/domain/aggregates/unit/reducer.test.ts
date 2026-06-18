import type { BusinessHours } from '@/domain'
import type { EventMeta } from '@/domain/effect/event-store'
import { describe, expect, it } from 'vitest'
import { applyUnitEvent } from './reducer'
import { INITIAL_UNIT_STATE, type UnitState } from './types'

const META: EventMeta = {
  version: 1,
  timestamp: '2026-06-18T10:00:00.000Z',
  actorId: 'owner-1',
  schemaVersion: 1,
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

const APPOINTMENT_STATE: UnitState = {
  ...INITIAL_UNIT_STATE,
  id: 'u1',
  orgId: 't1',
  agenda: {
    mode: 'appointment',
    businessHours: EMPTY,
    slotMinutes: 15,
    cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
    confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
    selfBookingPublished: false,
  },
}

// The self-booking publish state is an appointment-agenda concern (PRD
// Identidade v2, context 3 — moved Org→Unit). The reducer projects it into the
// `appointment` variant of `Unit.agenda` and is a NO-OP outside that mode (the
// flag doesn't exist there) — a branch replay can't exercise directly.
describe('applyUnitEvent — self-booking publish/unpublish', () => {
  it('publishes into the appointment agenda variant', () => {
    const next = applyUnitEvent(APPOINTMENT_STATE, { _tag: 'unit.self_booking_published' }, META)
    expect(next.agenda.mode).toBe('appointment')
    if (next.agenda.mode !== 'appointment') throw new Error('expected appointment')
    expect(next.agenda.selfBookingPublished).toBe(true)
    expect(next.agenda.selfBookingPublishedAt).toBe(META.timestamp)
  })

  it('unpublishes within the appointment agenda variant', () => {
    const published: UnitState = {
      ...APPOINTMENT_STATE,
      agenda: {
        mode: 'appointment',
        businessHours: EMPTY,
        slotMinutes: 15,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        selfBookingPublished: true,
      },
    }
    const next = applyUnitEvent(published, { _tag: 'unit.self_booking_unpublished' }, META)
    if (next.agenda.mode !== 'appointment') throw new Error('expected appointment')
    expect(next.agenda.selfBookingPublished).toBe(false)
  })

  it('is a no-op for a non-appointment unit (publish state does not exist there)', () => {
    const fixed: UnitState = {
      ...INITIAL_UNIT_STATE,
      id: 'u1',
      agenda: { mode: 'fixed', businessHours: EMPTY },
    }
    const published = applyUnitEvent(fixed, { _tag: 'unit.self_booking_published' }, META)
    expect(published.agenda).toEqual({ mode: 'fixed', businessHours: EMPTY })
    const unpublished = applyUnitEvent(fixed, { _tag: 'unit.self_booking_unpublished' }, META)
    expect(unpublished.agenda).toEqual({ mode: 'fixed', businessHours: EMPTY })
  })
})
