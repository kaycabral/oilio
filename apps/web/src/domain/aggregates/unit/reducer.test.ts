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

const HOURS: BusinessHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

const FIXED_STATE: UnitState = {
  ...INITIAL_UNIT_STATE,
  id: 'u1',
  orgId: 't1',
  agenda: { mode: 'fixed', businessHours: HOURS },
}

describe('applyUnitEvent — agenda transitions (inferred publication)', () => {
  it('switches the unit into the appointment agenda via unit.updated', () => {
    const next = applyUnitEvent(
      FIXED_STATE,
      {
        _tag: 'unit.updated',
        changes: {
          agenda: {
            mode: 'appointment',
            businessHours: HOURS,
            slotMinutes: 15,
            cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
            confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
          },
        },
      },
      META,
    )
    expect(next.agenda.mode).toBe('appointment')
    expect(next.updatedAt).toBe(META.timestamp)
    expect(next._version).toBe(META.version)
  })

  it('switches the unit back to a walk-in agenda via unit.updated', () => {
    const appointment: UnitState = {
      ...FIXED_STATE,
      agenda: {
        mode: 'appointment',
        businessHours: HOURS,
        slotMinutes: 15,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      },
    }
    const next = applyUnitEvent(
      appointment,
      { _tag: 'unit.updated', changes: { agenda: { mode: 'always_open' } } },
      META,
    )
    expect(next.agenda).toEqual({ mode: 'always_open' })
  })

  it('archives the unit, stamping archivedAt', () => {
    const next = applyUnitEvent(
      FIXED_STATE,
      { _tag: 'unit.archived', archivedAt: META.timestamp },
      META,
    )
    expect(next.archivedAt).toBe(META.timestamp)
  })
})
