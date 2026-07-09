import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { CategoryConfig } from './category/config'

async function checkReplay(
  id: string,
  data: Record<string, unknown>,
  changes: Record<string, unknown>,
): Promise<FirestoreDoc> {
  const { store, layer } = makeReplayStore()
  const ref = aggregateRef(CategoryConfig, 't1', id)

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(CategoryConfig, ref, {
        _tag: 'category.created',
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(CategoryConfig, ref, {
        _tag: 'category.updated',
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(docKey(ref))!
  const replayed = await Effect.runPromise(
    replayAggregate(CategoryConfig, ref).pipe(Effect.provide(layer)),
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
    const { layer } = makeReplayStore()
    const ref = aggregateRef(CategoryConfig, 't1', 'cat-del')
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CategoryConfig, ref, {
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
        yield* appendEvent(CategoryConfig, ref, {
          _tag: 'category.deleted',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )
    const replayed = await Effect.runPromise(
      replayAggregate(CategoryConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed._version).toBe(2)
    expect(replayed.name).toBe('Temp')
  })
})
