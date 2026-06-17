// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo da agenda
// (appointment + agenda_block). Prova que nenhum campo é escrito fora de eventos:
// para cada aggregate, a sequência de eventos → `replayAggregate` == projeção,
// campo a campo (deep-equal).

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { AgendaBlockConfig } from './agenda-block/config'
import { AppointmentConfig } from './appointment/config'

function makeStore() {
  const store = new Map<string, FirestoreDoc>()
  return {
    store,
    layer: Layer.succeed(FirestoreService, {
      getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
      getDocs: (collectionPath: string) =>
        Effect.succeed(
          [...store.entries()]
            .filter(([key]) => key.startsWith(collectionPath + '/'))
            .map(([, doc]) => doc)
            .sort(
              (a, b) =>
                (typeof a['version'] === 'number' ? a['version'] : 0) -
                (typeof b['version'] === 'number' ? b['version'] : 0),
            ),
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
    }),
  }
}

describe('Agenda — replay reconstrói o doc completo (event-first)', () => {
  it('appointment — created → updated → rescheduled → cancelled', async () => {
    const { store, layer } = makeStore()
    const path = 'tenants/t1/appointments/a1'
    const data = {
      id: 'a1',
      tenantId: 't1',
      unitId: 'u1',
      professionalId: 'pro1',
      customerId: 'c1',
      serviceId: 's1',
      startAt: '2026-06-01T13:00:00.000Z',
      endAt: '2026-06-01T13:30:00.000Z',
      status: 'scheduled',
      notes: null,
      servicePriceCentsSnapshot: 5000,
      serviceDurationMinutesSnapshot: 30,
      commissionSnapshot: { kind: 'percentage', value: 40 },
      customerUserId: 'user-c1',
      professionalUserId: 'user-pro1',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.updated',
          actorId: 'actor-1',
          payload: { changes: { professionalId: 'pro2', notes: 'VIP' } },
        })
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.rescheduled',
          actorId: 'actor-1',
          payload: {
            newStartAt: '2026-06-01T14:00:00.000Z',
            newEndAt: '2026-06-01T14:30:00.000Z',
            rescheduledBy: 'staff',
            rescheduledAt: '2026-06-01T10:00:00.000Z',
            noticeMinutes: 240,
          },
        })
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.cancelled',
          actorId: 'actor-1',
          payload: {
            cancelledBy: 'customer',
            cancelledAt: '2026-06-01T11:00:00.000Z',
            noticeMinutes: 180,
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(AppointmentConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(4)
    expect(replayed.status).toBe('cancelled')
    expect(replayed.professionalId).toBe('pro2')
    expect(replayed.startAt).toBe('2026-06-01T14:00:00.000Z')
    expect(replayed.cancelledNoticeMinutes).toBe(180)
    expect(replayed.rescheduledNoticeMinutes).toBe(240)
  })

  it('appointment — no_show → no_show_reverted volta pra scheduled', async () => {
    const { store, layer } = makeStore()
    const path = 'tenants/t1/appointments/a2'
    const data = {
      id: 'a2',
      tenantId: 't1',
      unitId: 'u1',
      professionalId: 'pro1',
      customerId: 'c1',
      serviceId: 's1',
      startAt: '2026-06-01T13:00:00.000Z',
      endAt: '2026-06-01T13:30:00.000Z',
      status: 'scheduled',
      notes: null,
      servicePriceCentsSnapshot: 5000,
      serviceDurationMinutesSnapshot: 30,
      commissionSnapshot: null,
      customerUserId: 'user-c1',
      professionalUserId: null,
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.no_show',
          actorId: 'actor-1',
          payload: { markedAt: '2026-06-01T13:05:00.000Z', markedBy: 'actor-1' },
        })
        yield* appendEvent(AppointmentConfig, path, {
          _tag: 'appointment.no_show_reverted',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(AppointmentConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(3)
    expect(replayed.status).toBe('scheduled')
  })

  it('agenda_block — created → updated (one_off)', async () => {
    const { store, layer } = makeStore()
    const path = 'tenants/t1/agenda_blocks/b1'
    const data = {
      id: 'b1',
      tenantId: 't1',
      unitId: 'u1',
      professionalId: null,
      reason: 'Almoço',
      kind: 'one_off',
      weekday: null,
      open: null,
      close: null,
      startAt: '2026-06-01T15:00:00.000Z',
      endAt: '2026-06-01T16:00:00.000Z',
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(AgendaBlockConfig, path, {
          _tag: 'agenda_block.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(AgendaBlockConfig, path, {
          _tag: 'agenda_block.updated',
          actorId: 'actor-1',
          payload: { changes: { reason: 'Médico' } },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(AgendaBlockConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    expect(replayed.reason).toBe('Médico')
  })
})
