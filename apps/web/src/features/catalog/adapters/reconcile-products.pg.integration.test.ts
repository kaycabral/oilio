import { CatalogItemConfig } from '@/domain/aggregates'
import type {
  AggregateRef,
  CollectionRef,
  FirestoreDoc,
  PersistenceOps,
  QueryConstraint,
} from '@/domain/effect'
import { aggregateRef, appendEvent, PersistencePort } from '@/domain/effect'
import { docKey } from '@/domain/effect/test-layers'
import {
  PUBLIC_DIRECTORY_UPSERT,
  publicOrgDirectoryValues,
} from '@/shared/db/pg/effect/org-projector'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { closeDb, getDb, PostgresProductSource, product } from '@cbrl/product'
import { Effect, Layer } from 'effect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcilePendingProducts } from './reconcile-products'

// Integration: reconciliation against REAL Postgres (brief 0050, AC-08). The
// projection side is an in-memory PersistencePort (the established unit pattern
// for event-store specs) — the LOAD-BEARING half here is the sovereign base, so
// it talks to real Postgres while the catalog items live in-memory. Telemetry is
// stubbed (it would write Firestore).
vi.mock('@/shared/product/product-events', () => ({
  emitProductEvent: () => Promise.resolve(),
}))

const NOW = new Date('2026-06-19T12:00:00.000Z')
const ORG = 'org-1'
const GTIN14 = '07891000100103'

// In-memory PersistencePort that honors the `reconciliationPending == true`
// where-filter the generator relies on (the shared replay-test store ignores
// constraints; reconciliation needs the filter to be real). Ref-keyed (D6) via
// `docKey`; the projection carries its own `id` (the reducer writes it from the
// event payload), so the collection read needs no path-derived id injection.
function makeStore() {
  const store = new Map<string, FirestoreDoc>()
  const matches = (doc: FirestoreDoc, constraints: readonly QueryConstraint[]): boolean =>
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
    setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
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
  // The reconciliation sweep reads and appends via the single PersistencePort —
  // back it from the one in-memory store.
  return {
    store,
    layer: Layer.succeed(PersistencePort, ops),
  }
}

// Seed the tenant so the sweep enumerates it. Post-cutover the generator lists
// orgs from the PUBLIC directory (`listAllOrgIds` → `public_org_directory` on the
// event-store DB), NOT from the in-memory store — so the row must exist in real
// Postgres for `reconcilePendingProducts` to visit this org. The in-memory store
// still backs the org's catalog items.
async function seedOrg(orgId: string): Promise<void> {
  // Reuse the projector's own directory upsert + values (single source of truth)
  // so this fixture can't drift from production when the directory schema evolves.
  const now = NOW.toISOString()
  await getEventStorePool().query(
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

// Seed a product catalog item carrying a reconciliation marker (the state the
// best-effort gate leaves when the base was down), via a real `created` event.
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

// Schema (both `produtos` and `oilio`) is applied once by the suite's
// globalSetup (pg-integration-global-setup.ts).
afterAll(async () => {
  await closeDb()
  await closeEventStoreDb()
})
beforeEach(async () => {
  await getDb().delete(product)
  // The public directory lives on the shared event-store DB — clear it so each
  // case enumerates only the org it seeds.
  await getEventStorePool().query('DELETE FROM public_org_directory')
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

    // The Product now exists in the base (auto-contributed).
    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.gtin14).toBe(GTIN14)

    // The marker is cleared on the item.
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
    // No duplicate row — referenced, not re-inserted.
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
    // Marker already cleared → the item no longer matches the pending query.
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
