// AC-01/AC-02 (brief 0023) — replay reconstrói o doc completo do CatalogItem
// unificado (serviço/produto). Para cada kind: created (snapshot) → updated
// (changes) → replayAggregate == projeção, campo a campo. Prova que nenhum
// campo é escrito fora de eventos (event-first) e que ambos os kinds
// reconstroem corretamente a partir do stream.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { CatalogItemConfig } from './catalog-item/config'

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

async function checkReplay(
  id: string,
  data: Record<string, unknown>,
  changes: Record<string, unknown>,
): Promise<FirestoreDoc> {
  const { store, layer } = makeStore()
  const path = `orgs/t1/catalog_items/${id}`

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(CatalogItemConfig, path, {
        _tag: 'catalog_item.created',
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(CatalogItemConfig, path, {
        _tag: 'catalog_item.updated',
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(path)!
  const replayed = await Effect.runPromise(
    replayAggregate(CatalogItemConfig, path).pipe(Effect.provide(layer)),
  )

  expect(replayed).toEqual(projection)
  expect(replayed._version).toBe(2)
  return projection
}

describe('CatalogItem — replay reconstrói o doc completo (event-first)', () => {
  it('service kind', async () => {
    const doc = await checkReplay(
      'svc1',
      {
        id: 'svc1',
        orgId: 't1',
        kind: 'service',
        name: 'Corte',
        categoryId: 'cat-1',
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: ['u1'],
        unitOverrides: null,
        publicVisible: true,
        priceVisibility: 'visible',
        active: true,
        durationMinutes: 30,
        requiredResources: ['cadeira-1'],
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      { priceCents: 6000 },
    )
    expect(doc['kind']).toBe('service')
    expect(doc['durationMinutes']).toBe(30)
    expect(doc['priceCents']).toBe(6000)
  })

  it('product kind', async () => {
    const doc = await checkReplay(
      'prod1',
      {
        id: 'prod1',
        orgId: 't1',
        kind: 'product',
        name: 'Pomada',
        categoryId: 'cat-2',
        priceCents: 3000,
        commission: null,
        unitIds: ['u1'],
        unitOverrides: null,
        publicVisible: false,
        priceVisibility: 'visible',
        active: true,
        sku: 'POM-001',
        stock: 10,
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      { stock: 8 },
    )
    expect(doc['kind']).toBe('product')
    expect(doc['sku']).toBe('POM-001')
    expect(doc['stock']).toBe(8)
  })

  // Degenerate datum (#1002 test plan): uncategorized product without
  // commission. Replay must still reconstruct it faithfully.
  it('degenerate — product, categoryId null, commission null', async () => {
    const doc = await checkReplay(
      'prod2',
      {
        id: 'prod2',
        orgId: 't1',
        kind: 'product',
        name: 'Item Solto',
        categoryId: null,
        priceCents: 0,
        commission: null,
        unitIds: ['u1'],
        unitOverrides: null,
        publicVisible: false,
        priceVisibility: 'visible',
        active: false,
        sku: null,
        stock: 0,
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      { active: true },
    )
    expect(doc['categoryId']).toBeNull()
    expect(doc['commission']).toBeNull()
    expect(doc['active']).toBe(true)
  })

  it('delete não ressuscita a projeção (hard-delete via caller)', async () => {
    const { layer } = makeStore()
    const path = 'orgs/t1/catalog_items/svc-del'
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CatalogItemConfig, path, {
          _tag: 'catalog_item.created',
          actorId: 'actor-1',
          payload: {
            data: {
              id: 'svc-del',
              orgId: 't1',
              kind: 'service',
              name: 'Temp',
              categoryId: null,
              priceCents: 1000,
              commission: null,
              unitIds: ['u1'],
              unitOverrides: null,
              publicVisible: false,
              priceVisibility: 'visible',
              active: true,
              durationMinutes: 15,
              requiredResources: [],
              archivedAt: null,
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(CatalogItemConfig, path, {
          _tag: 'catalog_item.deleted',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )
    // Replay from the stream still yields the last state (event log is the
    // source of truth); the projection doc removal is the caller's hard-delete.
    const replayed = await Effect.runPromise(
      replayAggregate(CatalogItemConfig, path).pipe(Effect.provide(layer)),
    )
    expect(replayed._version).toBe(2)
    expect(replayed.name).toBe('Temp')
  })
})
