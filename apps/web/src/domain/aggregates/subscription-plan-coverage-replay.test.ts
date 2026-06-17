// Brief 0024 (#1008) — plan coverage by granular items.
//
// Proves, event-first, that a plan's coverage (`includedItemIds` +
// `includedCategoryIds`) is reconstructible purely from the domain event
// stream: `created` carries the initial coverage snapshot, a coverage-change
// `updated` event mutates it, and `replayAggregate` rebuilds the exact
// projection from events only (no field written outside an event).
//
// Also asserts Group C's invariant (AC-06): there is NO opaque "combo/pacote"
// `CatalogItem` kind — a package IS a plan's coverage (a set of granular
// items), enforced by `CATALOG_ITEM_KINDS` being exactly {service, product}.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { CATALOG_ITEM_KINDS } from '@/domain/types/catalog-item'
import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { SubscriptionPlanConfig } from './subscription-plan/config'

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

describe('SubscriptionPlan coverage — replay reconstructs items + categories (event-first)', () => {
  it('AC-01/AC-02 — created carries coverage; a coverage-change event mutates it; replay == projection', async () => {
    const { store, layer } = makeStore()
    const path = 'tenants/t1/subscription_plans/plan-cov'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(SubscriptionPlanConfig, path, {
          _tag: 'subscription_plan.created',
          actorId: 'owner-1',
          payload: {
            data: {
              id: 'plan-cov',
              tenantId: 't1',
              name: 'Combo Barba + Pomada',
              description: null,
              priceCents: 12000,
              billingCycle: 'monthly',
              // Coverage = granular items (a service + a product) + a
              // convenience category. No opaque combo item — the package IS
              // this set (AC-06).
              includedItemIds: ['svc-barba', 'prod-pomada'],
              includedCategoryIds: ['cat-cabelo'],
              usageLimit: { kind: 'unlimited' },
              active: true,
              archivedAt: null,
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        // Coverage-change: drop a category, add a third item. Flows through a
        // domain event (never a direct write).
        yield* appendEvent(SubscriptionPlanConfig, path, {
          _tag: 'subscription_plan.updated',
          actorId: 'owner-1',
          payload: {
            changes: {
              includedItemIds: ['svc-barba', 'prod-pomada', 'svc-corte'],
              includedCategoryIds: [],
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(SubscriptionPlanConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed.includedItemIds).toEqual(['svc-barba', 'prod-pomada', 'svc-corte'])
    expect(replayed.includedCategoryIds).toEqual([])
    expect(replayed._version).toBe(2)
  })
})

describe('AC-06 — no opaque combo CatalogItem kind (invariant)', () => {
  it('CatalogItem kind is exactly {service, product} — a package is plan coverage, never a combo item', () => {
    expect([...CATALOG_ITEM_KINDS]).toEqual(['service', 'product'])
    expect(CATALOG_ITEM_KINDS).not.toContain('combo')
    expect(CATALOG_ITEM_KINDS).not.toContain('package')
    expect(CATALOG_ITEM_KINDS).not.toContain('bundle')
  })
})
