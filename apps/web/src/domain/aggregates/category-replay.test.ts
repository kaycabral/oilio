// AC-03/AC-04 (brief 0023, #1003) — replay reconstrói o doc completo do
// Category (entidade de categoria do catálogo). created (snapshot) → updated
// (changes) → replayAggregate == projeção, campo a campo. Prova que nenhum
// campo é escrito fora de eventos (event-first) e cobre o caso degenerado
// (categoria sem icon/color).

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { CategoryConfig } from './category/config'

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
  const path = `orgs/t1/categories/${id}`

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(CategoryConfig, path, {
        _tag: 'category.created',
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(CategoryConfig, path, {
        _tag: 'category.updated',
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(path)!
  const replayed = await Effect.runPromise(
    replayAggregate(CategoryConfig, path).pipe(Effect.provide(layer)),
  )

  expect(replayed).toEqual(projection)
  expect(replayed._version).toBe(2)
  return projection
}

describe('Category — replay reconstrói o doc completo (event-first)', () => {
  it('categoria completa (icon + color) — rename via update', async () => {
    const doc = await checkReplay(
      'cat-1',
      {
        id: 'cat-1',
        orgId: 't1',
        name: 'Cabelo',
        icon: 'scissors',
        color: '#3366ff',
        active: true,
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      { name: 'Cabelo & Barba' },
    )
    expect(doc['name']).toBe('Cabelo & Barba')
    expect(doc['icon']).toBe('scissors')
    expect(doc['color']).toBe('#3366ff')
    expect(doc['active']).toBe(true)
  })

  // Degenerate datum (#1003 test plan): categoria sem icon nem color. Replay
  // deve reconstruir fielmente os nulls.
  it('degenerate — categoria sem icon/color', async () => {
    const doc = await checkReplay(
      'cat-2',
      {
        id: 'cat-2',
        orgId: 't1',
        name: 'Estética',
        icon: null,
        color: null,
        active: false,
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      { active: true },
    )
    expect(doc['icon']).toBeNull()
    expect(doc['color']).toBeNull()
    expect(doc['active']).toBe(true)
  })

  it('delete não ressuscita a projeção (hard-delete via caller)', async () => {
    const { layer } = makeStore()
    const path = 'orgs/t1/categories/cat-del'
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CategoryConfig, path, {
          _tag: 'category.created',
          actorId: 'actor-1',
          payload: {
            data: {
              id: 'cat-del',
              orgId: 't1',
              name: 'Temp',
              icon: null,
              color: null,
              active: true,
              archivedAt: null,
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(CategoryConfig, path, {
          _tag: 'category.deleted',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )
    // Replay from the stream still yields the last state (event log is the
    // source of truth); the projection doc removal is the caller's hard-delete.
    const replayed = await Effect.runPromise(
      replayAggregate(CategoryConfig, path).pipe(Effect.provide(layer)),
    )
    expect(replayed._version).toBe(2)
    expect(replayed.name).toBe('Temp')
  })
})
