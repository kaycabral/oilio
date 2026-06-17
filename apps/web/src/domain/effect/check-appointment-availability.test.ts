import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { checkAppointmentAvailability } from './check-appointment-availability'
import type { FirestoreDoc } from './services'
import { FirestoreService } from './services'

function makeTestFirestoreLayer(docs: Record<string, FirestoreDoc>) {
  const store = new Map(Object.entries(docs))

  return Layer.succeed(FirestoreService, {
    getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
    getDocs: (collectionPath: string) =>
      Effect.succeed(
        [...store.entries()]
          .filter(([key]) => key.startsWith(collectionPath + '/'))
          .map(([, doc]) => doc),
      ),
    setDoc: (path: string, data: FirestoreDoc) =>
      Effect.sync(() => {
        store.set(path, { ...store.get(path), ...data })
      }),
    runTransaction: (fn) =>
      fn({
        getDoc: (path) => Effect.succeed(store.get(path) ?? null),
        setDoc: (path, data) =>
          Effect.sync(() => {
            store.set(path, { ...store.get(path), ...data })
          }),
      }),
  })
}

const BASE_INPUT = {
  tenantId: 't1',
  unitId: 'u1',
  professionalId: 'prof-1',
  proposed: { startAt: '2026-06-01T14:00:00Z', endAt: '2026-06-01T15:00:00Z' },
  date: '2026-06-01',
  tz: 'America/Sao_Paulo',
} as const

describe('checkAppointmentAvailability', () => {
  it('AC-06: resolves via FirestoreService layer — no direct singleton import', async () => {
    const layer = makeTestFirestoreLayer({
      'tenants/t1/professionals/prof-1': { id: 'prof-1', name: 'João' },
    })

    const result = await Effect.runPromise(
      checkAppointmentAvailability(BASE_INPUT).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({ available: true })
  })

  it('AC-05: returns AppointmentConflictError when slot is occupied', async () => {
    const layer = makeTestFirestoreLayer({
      'tenants/t1/professionals/prof-1': { id: 'prof-1', name: 'João' },
      'tenants/t1/appointments/apt-99': {
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
      'tenants/t1/professionals/prof-1': { id: 'prof-1', name: 'João' },
    })

    const busyLayer = makeTestFirestoreLayer({
      'tenants/t1/professionals/prof-1': { id: 'prof-1', name: 'João' },
      'tenants/t1/appointments/apt-1': {
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
})
