import { CatalogItemConfig } from '@/domain/aggregates'
import type {
  AggregateRef,
  CollectionRef,
  PersistenceOps,
  QueryConstraint,
  StoredDoc,
} from '@/domain/effect'
import { aggregateRef, appendEvent, PersistencePort } from '@/domain/effect'
import { docKey } from '@/domain/effect/test-layers'
import { closeDb, getDb, PostgresProductSource, product } from '@/product'
import {
  PUBLIC_DIRECTORY_UPSERT,
  publicOrgDirectoryValues,
} from '@/shared/db/pg/effect/org-projector'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { Effect, Layer } from 'effect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcilePendingProducts } from './reconcile-products'

vi.mock('@/shared/product/product-events', () => ({
  emitProductEvent: () => Promise.resolve(),
}))

const NOW = new Date('2026-06-19T12:00:00.000Z')
const ORG = 'org-1'
const GTIN14 = '07891000100103'

function makeStore() {
  const store = new Map<string, StoredDoc>()
  const matches = (doc: StoredDoc, constraints: readonly QueryConstraint[]): boolean =>
    constraints.every((c) => {
      if (c.kind !== 'where' || c.op !== '==') return true
      return doc[c.field] === c.value
    })
  const collectionKey = (ref: CollectionRef): string => `${ref.type}/${ref.orgId}/`
  const ops: PersistenceOps = {
    getDoc: (ref: AggregateRef) => Effect.succeed(store.get(docKey(ref)) ?? null),
    getDocs: (ref: CollectionRef, constraints: readonly QueryConstraint[] = []) =>
      Effect.succeed(
        [...store.entries()]
          .filter(([key]) => key.startsWith(collectionKey(ref)))
          .map(([, doc]) => doc)
          .filter((doc) => matches(doc, constraints)),
      ),
    getEvents: () => Effect.succeed([]),
    setDoc: (ref: AggregateRef, data: StoredDoc) =>
      Effect.sync(() => {
        const key = docKey(ref)
        store.set(key, { ...store.get(key), ...data })
      }),
    runTransaction: (fn) =>
      fn({
        getDoc: (ref) => Effect.succeed(store.get(docKey(ref)) ?? null),
        setDoc: (ref, data) =>
          Effect.sync(() => {
            const key = docKey(ref)
            store.set(key, { ...store.get(key), ...data })
          }),
        appendEvent: () => Effect.void,
      }),
  }
  return {
    store,
    layer: Layer.succeed(PersistencePort, ops),
  }
}

async function seedOrg(orgId: string): Promise<void> {
  const now = NOW.toISOString()
  await ownerPool().query(
    PUBLIC_DIRECTORY_UPSERT,
    publicOrgDirectoryValues({
      id: orgId,
      slug: `slug-${orgId}`,
      name: 'Org X',
      vertical: 'other',
      website: null,
      ownerUserId: `owner-${orgId}`,
      branding: { logoUrl: null, bannerUrl: null, description: null },
      createdAt: now,
      updatedAt: now,
    }),
  )
}

function seedPendingItem(
  layer: Layer.Layer<PersistencePort>,
  id: string,
  gtin14: string | null,
): Promise<void> {
  return Effect.runPromise(
    appendEvent(CatalogItemConfig, aggregateRef(CatalogItemConfig, ORG, id), {
      _tag: 'catalog_item.created',
      actorId: 'actor-1',
      payload: {
        data: {
          id,
          orgId: ORG,
          kind: 'product',
          name: 'Leite',
          categoryId: null,
          priceCents: 1000,
          commission: null,
          unitIds: ['u1'],
          unitOverrides: null,
          publicVisible: false,
          priceVisibility: 'visible',
          active: true,
          archivedAt: null,
          sku: null,
          stock: 0,
          gtin14,
          reconciliationPending: true,
          reconciliationLastAttempt: '2026-06-19T11:00:00.000Z',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      },
    }).pipe(Effect.provide(layer)),
  ).then(() => undefined)
}

afterAll(async () => {
  await closeDb()
  await closeEventStoreDb()
})
beforeEach(async () => {
  await getDb().delete(product)
  await ownerPool().query('DELETE FROM public_org_directory')
})

describe('reconcilePendingProducts — against real Postgres', () => {
  it('auto-contributes a deferred GTIN and clears the marker (AC-08)', async () => {
    const { store, layer } = makeStore()
    await seedOrg(ORG)
    await seedPendingItem(layer, 'item-1', GTIN14)

    const reconciled = await Effect.runPromise(
      reconcilePendingProducts(NOW).pipe(Effect.provide(layer)),
    )
    expect(reconciled).toBe(1)

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.gtin14).toBe(GTIN14)

    const doc = store.get(docKey(aggregateRef(CatalogItemConfig, ORG, 'item-1')))
    expect(doc?.reconciliationPending).toBe(false)
    expect(doc?.gtin14).toBe(GTIN14)
  })

  it('references an already-known GTIN without duplicating (idempotent)', async () => {
    await new PostgresProductSource().upsert({
      gtin14: GTIN14,
      name: 'Official',
      source: 'official',
    })
    const { store, layer } = makeStore()
    await seedOrg(ORG)
    await seedPendingItem(layer, 'item-1', GTIN14)

    const reconciled = await Effect.runPromise(
      reconcilePendingProducts(NOW).pipe(Effect.provide(layer)),
    )
    expect(reconciled).toBe(1)
    expect(await getDb().select().from(product)).toHaveLength(1)
    expect(
      store.get(docKey(aggregateRef(CatalogItemConfig, ORG, 'item-1')))?.reconciliationPending,
    ).toBe(false)
  })

  it('re-running does not duplicate and finds nothing new (idempotent sweep)', async () => {
    const { store, layer } = makeStore()
    await seedOrg(ORG)
    await seedPendingItem(layer, 'item-1', GTIN14)

    const first = await Effect.runPromise(reconcilePendingProducts(NOW).pipe(Effect.provide(layer)))
    const second = await Effect.runPromise(
      reconcilePendingProducts(NOW).pipe(Effect.provide(layer)),
    )
    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(await getDb().select().from(product)).toHaveLength(1)
    void store
  })

  it('reconciles each pending item independently (per-item, multi-item)', async () => {
    const { store, layer } = makeStore()
    await seedOrg(ORG)
    await seedPendingItem(layer, 'item-1', GTIN14)
    await seedPendingItem(layer, 'item-2', '7894900011517')

    const reconciled = await Effect.runPromise(
      reconcilePendingProducts(NOW).pipe(Effect.provide(layer)),
    )
    expect(reconciled).toBe(2)
    expect(await getDb().select().from(product)).toHaveLength(2)
    expect(
      store.get(docKey(aggregateRef(CatalogItemConfig, ORG, 'item-1')))?.reconciliationPending,
    ).toBe(false)
    expect(
      store.get(docKey(aggregateRef(CatalogItemConfig, ORG, 'item-2')))?.reconciliationPending,
    ).toBe(false)
  })

  it('clears a malformed pending marker that has no GTIN (no orphan loop)', async () => {
    const { store, layer } = makeStore()
    await seedOrg(ORG)
    await seedPendingItem(layer, 'item-1', null)

    const reconciled = await Effect.runPromise(
      reconcilePendingProducts(NOW).pipe(Effect.provide(layer)),
    )
    expect(reconciled).toBe(1)
    expect(
      store.get(docKey(aggregateRef(CatalogItemConfig, ORG, 'item-1')))?.reconciliationPending,
    ).toBe(false)
    expect(await getDb().select().from(product)).toHaveLength(0)
  })
})
