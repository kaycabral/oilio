import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { CatalogItemConfig } from './catalog-item/config'

async function checkReplay(
  id: string,
  data: Record<string, unknown>,
  changes: Record<string, unknown>,
): Promise<FirestoreDoc> {
  const { store, layer } = makeReplayStore()
  const ref = aggregateRef(CatalogItemConfig, 't1', id)

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(CatalogItemConfig, ref, {
        _tag: 'catalog_item.created',
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(CatalogItemConfig, ref, {
        _tag: 'catalog_item.updated',
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(docKey(ref))!
  const replayed = await Effect.runPromise(
    replayAggregate(CatalogItemConfig, ref).pipe(Effect.provide(layer)),
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
        gtin14: null,
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
        gtin14: null,
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
    const { layer } = makeReplayStore()
    const ref = aggregateRef(CatalogItemConfig, 't1', 'svc-del')
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CatalogItemConfig, ref, {
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
        yield* appendEvent(CatalogItemConfig, ref, {
          _tag: 'catalog_item.deleted',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )
    const replayed = await Effect.runPromise(
      replayAggregate(CatalogItemConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed._version).toBe(2)
    expect(replayed.name).toBe('Temp')
  })
})
