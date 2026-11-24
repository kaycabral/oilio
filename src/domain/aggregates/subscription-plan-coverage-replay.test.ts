import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { CATALOG_ITEM_KINDS } from '@/domain/types/catalog-item'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { SubscriptionPlanConfig } from './subscription-plan/config'

describe('SubscriptionPlan coverage — replay reconstructs items + categories (event-first)', () => {
  it('AC-01/AC-02 — created carries coverage; a coverage-change event mutates it; replay == projection', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(SubscriptionPlanConfig, 't1', 'plan-cov')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(SubscriptionPlanConfig, ref, {
          _tag: 'subscription_plan.created',
          actorId: 'owner-1',
          payload: {
            data: {
              id: 'plan-cov',
              orgId: 't1',
              name: 'Combo Barba + Pomada',
              description: null,
              priceCents: 12000,
              billingCycle: 'monthly',
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
        yield* appendEvent(SubscriptionPlanConfig, ref, {
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

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(SubscriptionPlanConfig, ref).pipe(Effect.provide(layer)),
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
