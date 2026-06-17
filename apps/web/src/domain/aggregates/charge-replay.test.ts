// AC-09/AC-10 (brief 0025), fatia charge (#1025) — gateway-gated: converge o
// domínio + replay + unit agora; o E2E desses fluxos espera a parceria ligar o
// gateway. created (snapshot scheduled) → failed (recovering) → succeeded
// (paid) → replay == projeção, campo a campo.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { ChargeConfig } from './charge/config'

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

describe('Charge — replay reconstrói o doc completo (event-first, gateway-gated)', () => {
  it('created (scheduled) → failed (recovering) → succeeded (paid) → replay == projeção', async () => {
    const { store, layer } = makeStore()
    const path = 'tenants/t1/charges/ch1'
    const data = {
      id: 'ch1',
      tenantId: 't1',
      unitId: 'unit-a',
      subscriptionId: 'sub1',
      customerId: 'c1',
      amountCents: 9900,
      periodStartAt: '2026-06-01T00:00:00.000Z',
      periodEndAt: '2026-07-01T00:00:00.000Z',
      dueDate: '2026-06-01T00:00:00.000Z',
      status: 'scheduled',
      attempts: 0,
      paidAt: null,
      failedAt: null,
      failureReason: null,
      lastActorUid: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(ChargeConfig, path, {
          _tag: 'charge.created',
          actorId: 'system',
          payload: { data },
        })
        yield* appendEvent(ChargeConfig, path, {
          _tag: 'charge.failed',
          actorId: 'system:webhook',
          payload: {
            changes: {
              status: 'recovering',
              attempts: 1,
              failedAt: '2026-07-01T03:00:00.000Z',
              failureReason: 'card_declined',
            },
          },
        })
        yield* appendEvent(ChargeConfig, path, {
          _tag: 'charge.succeeded',
          actorId: 'system:webhook',
          payload: {
            changes: {
              status: 'paid',
              attempts: 2,
              paidAt: '2026-07-02T10:00:00.000Z',
              failedAt: null,
              failureReason: null,
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(ChargeConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(3)
    expect(replayed.status).toBe('paid')
    expect(replayed.attempts).toBe(2)
    expect(replayed.paidAt).toBe('2026-07-02T10:00:00.000Z')
    expect(replayed.amountCents).toBe(9900)
    // unitId (snapshot do ciclo, brief 0043 AC-02) sobrevive ao replay.
    expect(replayed.unitId).toBe('unit-a')
  })
})
