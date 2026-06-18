// AC-09/AC-10 (brief 0025), fatia caixa (#1019) — caixa sem sessão (0015):
// o movimento de caixa é event-first (created carrega o snapshot completo,
// standalone, sem cashRegisterId). created → replay == projeção, campo a campo.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { CashMovementConfig } from './cash-movement/config'

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

describe('CashMovement — replay reconstrói o doc completo (event-first)', () => {
  it('created (snapshot) → replay == projeção', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/cash_movements/m1'
    const data = {
      id: 'm1',
      orgId: 't1',
      unitId: 'u1',
      kind: 'sale',
      direction: 'in',
      amountCents: 5000,
      paymentMethod: 'cash',
      description: null,
      orderId: 'o1',
      expenseCategoryId: null,
      recordedByUid: 'user-1',
      createdAt: '2026-06-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CashMovementConfig, path, {
          _tag: 'cash_movement.created',
          actorId: 'user-1',
          payload: { data },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(CashMovementConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(1)
    expect(replayed.kind).toBe('sale')
    expect(replayed.amountCents).toBe(5000)
    expect(replayed.orderId).toBe('o1')
    expect(replayed.createdAt).toBe('2026-06-01T12:00:00.000Z')
  })
})
