import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { AgendaBlockConfig } from '@/domain/aggregates/agenda-block/config'
import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { ProfessionalConfig } from '@/domain/aggregates/professional/config'
import { aggregateRef } from '@/domain/effect/aggregate-ref'
import { docKey, makeTestFirestoreLayer } from '@/domain/effect/test-layers'

import { checkAppointmentAvailability } from './check-appointment-availability'

const professionalKey = (orgId: string, id: string) =>
  docKey(aggregateRef(ProfessionalConfig, orgId, id))
const appointmentKey = (orgId: string, id: string) =>
  docKey(aggregateRef(AppointmentConfig, orgId, id))
const agendaBlockKey = (orgId: string, id: string) =>
  docKey(aggregateRef(AgendaBlockConfig, orgId, id))

const BASE_INPUT = {
  orgId: 't1',
  unitId: 'u1',
  professionalId: 'prof-1',
  proposed: { startAt: '2026-06-01T14:00:00Z', endAt: '2026-06-01T15:00:00Z' },
  date: '2026-06-01',
  tz: 'America/Sao_Paulo',
} as const

describe('checkAppointmentAvailability', () => {
  it('AC-06: resolves via PersistencePort layer — no direct singleton import', async () => {
    const layer = makeTestFirestoreLayer({
      [professionalKey('t1', 'prof-1')]: { id: 'prof-1', name: 'João' },
    })

    const result = await Effect.runPromise(
      checkAppointmentAvailability(BASE_INPUT).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({ available: true })
  })

  it('AC-05: returns AppointmentConflictError when slot is occupied', async () => {
    const layer = makeTestFirestoreLayer({
      [professionalKey('t1', 'prof-1')]: { id: 'prof-1', name: 'João' },
      [appointmentKey('t1', 'apt-99')]: {
        id: 'apt-99',
        unitId: 'u1',
        professionalId: 'prof-1',
        startAt: '2026-06-01T14:30:00Z',
        endAt: '2026-06-01T15:30:00Z',
        status: 'scheduled',
      },
    })

    const result = await Effect.runPromise(
      checkAppointmentAvailability(BASE_INPUT).pipe(
        Effect.catchTag('AppointmentConflictError', (e) =>
          Effect.succeed({
            caught: true,
            tag: e._tag,
            conflictingIds: e.conflictingIds,
          }),
        ),
        Effect.provide(layer),
      ),
    )

    expect(result).toEqual({
      caught: true,
      tag: 'AppointmentConflictError',
      conflictingIds: ['apt-99'],
    })
  })

  it('AC-05: returns EntityNotFoundError when professional does not exist', async () => {
    const layer = makeTestFirestoreLayer({})

    const result = await Effect.runPromise(
      checkAppointmentAvailability(BASE_INPUT).pipe(
        Effect.catchTag('EntityNotFoundError', (e) =>
          Effect.succeed({ caught: true, entity: e.entity, id: e.id }),
        ),
        Effect.provide(layer),
      ),
    )

    expect(result).toEqual({
      caught: true,
      entity: 'Professional',
      id: 'prof-1',
    })
  })

  it('AC-07: same production code works with different test layer data', async () => {
    const emptyLayer = makeTestFirestoreLayer({
      [professionalKey('t1', 'prof-1')]: { id: 'prof-1', name: 'João' },
    })

    const busyLayer = makeTestFirestoreLayer({
      [professionalKey('t1', 'prof-1')]: { id: 'prof-1', name: 'João' },
      [appointmentKey('t1', 'apt-1')]: {
        id: 'apt-1',
        unitId: 'u1',
        professionalId: 'prof-1',
        startAt: '2026-06-01T14:00:00Z',
        endAt: '2026-06-01T15:00:00Z',
        status: 'scheduled',
      },
    })

    const program = checkAppointmentAvailability(BASE_INPUT).pipe(
      Effect.catchTag('AppointmentConflictError', () =>
        Effect.succeed({ available: false as const }),
      ),
    )

    const emptyResult = await Effect.runPromise(program.pipe(Effect.provide(emptyLayer)))
    const busyResult = await Effect.runPromise(program.pipe(Effect.provide(busyLayer)))

    expect(emptyResult).toEqual({ available: true })
    expect(busyResult).toEqual({ available: false })
  })

  it('AC-05: a one-off agenda block over the slot makes it unavailable', async () => {
    const layer = makeTestFirestoreLayer({
      [professionalKey('t1', 'prof-1')]: { id: 'prof-1', name: 'João' },
      [agendaBlockKey('t1', 'blk-1')]: {
        id: 'blk-1',
        orgId: 't1',
        unitId: 'u1',
        professionalId: 'prof-1',
        reason: 'Médico',
        kind: 'one_off',
        weekday: null,
        open: null,
        close: null,
        startAt: '2026-06-01T14:00:00Z',
        endAt: '2026-06-01T15:00:00Z',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    })

    const result = await Effect.runPromise(
      checkAppointmentAvailability(BASE_INPUT).pipe(
        Effect.catchTag('AppointmentConflictError', () =>
          Effect.succeed({ available: false as const }),
        ),
        Effect.provide(layer),
      ),
    )

    expect(result).toEqual({ available: false })
  })
})
