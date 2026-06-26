// Brief 0030 (AC-01/AC-02) — DoD de replay do aggregate `order`:
// uma VENDA AVULSA (standalone, `appointmentId: null`) e SEM CLIENTE
// (`customerId: null`) reconstrói campo-a-campo só pelos eventos. Prova que o
// snapshot generalizado de `order.created` aceita os dois nulos e que o estado
// é projeção descartável (ADR 0010): created → item_added → closed, replay ==
// projeção. Mocks de Firestore são proibidos em rules-bound tests, mas replay é
// reconstrução pura do event store — o store em memória aqui é o próprio
// substrato de eventos, não um mock de regra.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '@/domain/effect/event-store'
import type { FirestoreDoc } from '@/domain/effect/services'
import { PersistencePort } from '@/domain/effect/services'
import { OrderConfig } from './order/config'

function makeStore() {
  const store = new Map<string, FirestoreDoc>()
  return {
    store,
    layer: Layer.succeed(PersistencePort, {
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

const STANDALONE_ITEM = {
  id: 'i1',
  kind: 'product' as const,
  refId: 'prod-1',
  name: 'Cimento CP-II 50kg',
  quantity: 2,
  unitPriceCents: 3500,
  commission: null,
  // Venda avulsa de produto (varejo): o item é atribuído ao `userId` do membro
  // que abriu a venda (o operador). NÃO é um doc id de Professional — a recepção
  // que vende balcão não tem Professional. É o caso que a fatia #1056 habilita.
  attributedUserId: 'opener-user-1',
}

describe('Order — venda avulsa sem cliente reconstrói do event store (brief 0030)', () => {
  it('created(appointmentId:null, customerId:null) → item_added → closed: replay == projeção', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/orders/o-standalone'

    const snapshot = {
      id: 'o-standalone',
      orgId: 't1',
      unitId: 'u1',
      // Os dois nulos que esta fatia habilita (AC-01 + AC-02).
      customerId: null,
      appointmentId: null,
      status: 'open',
      items: [],
      discountCents: 0,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: 0,
      totalCents: 0,
      createdAt: '2026-06-03T10:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(OrderConfig, path, {
          _tag: 'order.created',
          actorId: 'user-1',
          payload: { data: snapshot },
        })
        yield* appendEvent(OrderConfig, path, {
          _tag: 'order.item_added',
          actorId: 'user-1',
          payload: {
            changes: { items: [STANDALONE_ITEM], subtotalCents: 7000, totalCents: 7000 },
          },
        })
        yield* appendEvent(OrderConfig, path, {
          _tag: 'order.closed',
          actorId: 'user-1',
          payload: {
            closedAt: '2026-06-03T10:05:00.000Z',
            subtotalCents: 7000,
            totalCents: 7000,
            paymentMethod: 'cash',
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(OrderConfig, path).pipe(Effect.provide(layer)),
    )

    // Estado é projeção descartável: replay reconstrói o doc inteiro.
    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(3)
    // Os nulos sobrevivem ao replay — venda avulsa anônima.
    expect(replayed.customerId).toBeNull()
    expect(replayed.appointmentId).toBeNull()
    // Conteúdo e fechamento reconstruídos.
    expect(replayed.status).toBe('closed')
    expect(replayed.items).toHaveLength(1)
    expect(replayed.items[0]!.refId).toBe('prod-1')
    // Atribuição por membro (brief 0030, AC-04): o produto avulso fica atribuído
    // ao `userId` do operador que abriu a venda — sobrevive ao replay.
    expect(replayed.items[0]!.attributedUserId).toBe('opener-user-1')
    expect(replayed.totalCents).toBe(7000)
    expect(replayed.paymentMethod).toBe('cash')
  })
})
