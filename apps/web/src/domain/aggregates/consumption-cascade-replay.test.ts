// Brief 0024, Grupo B (AC-04/05) — replay da cascata de consumo granular.
//
// Ao fechar uma comanda com itens cobertos pela assinatura, a saga emite (em
// sequência) os eventos de cada aggregate-folha: o serviço coberto debita a cota
// (`subscription.usage_incremented`) sem comissão; o produto coberto debita a
// cota E baixa estoque (`catalog_item.updated`). Este teste prova que cada
// aggregate é reconstruível só pelos eventos (replay == projeção), e que a
// quantidade coberta (qualquer kind) decrementa a cota e o estoque corretos.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { PersistencePort } from '../effect/services'
import { isCatalogProduct } from '../types/catalog-item'
import type { SubscriptionPlanSnapshot } from '../types/subscription'
import { coveredItemQuantity, coveredProducts } from '../utils/order'
import { isItemCoveredBySubscription } from '../utils/subscription-coverage'
import { CatalogItemConfig } from './catalog-item/config'
import { SubscriptionConfig } from './subscription/config'

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

const PLAN: SubscriptionPlanSnapshot = {
  planId: 'plan-1',
  name: 'Mensal Premium',
  priceCents: 12000,
  billingCycle: 'monthly',
  includedItemIds: ['svc-barba'],
  includedCategoryIds: ['cat-produtos'],
  usageLimit: { kind: 'count', quantity: 10 },
}

const COVERED_SERVICE = {
  id: 'oi-1',
  kind: 'service' as const,
  refId: 'svc-barba',
  name: 'Barba',
  quantity: 1,
  unitPriceCents: 4000,
  commission: null,
  attributedUserId: 'p1',
  coverage: 'subscription' as const,
  subscriptionId: 'sub-1',
}
const COVERED_PRODUCT = {
  id: 'oi-2',
  kind: 'product' as const,
  refId: 'prod-pomada',
  name: 'Pomada',
  quantity: 2,
  unitPriceCents: 1500,
  commission: null,
  attributedUserId: 'p1',
  coverage: 'subscription' as const,
  subscriptionId: 'sub-1',
}

describe('Brief 0024 — consumo granular: resolver + cascata de replay', () => {
  it('resolve serviço (item direto) e produto (categoria expandida) como cobertos', () => {
    // svc-barba ∈ includedItemIds; prod-pomada coberto pela categoria cat-produtos.
    expect(isItemCoveredBySubscription(PLAN, { id: 'svc-barba', categoryId: 'cat-corte' })).toBe(
      true,
    )
    expect(
      isItemCoveredBySubscription(PLAN, { id: 'prod-pomada', categoryId: 'cat-produtos' }),
    ).toBe(true)
    // item fora do snapshot não fecha.
    expect(isItemCoveredBySubscription(PLAN, { id: 'svc-corte', categoryId: 'cat-corte' })).toBe(
      false,
    )
  })

  it('a cota debitada conta serviço + produto; só produto baixa estoque', () => {
    const items = [COVERED_SERVICE, COVERED_PRODUCT]
    // 1 serviço (qty 1) + 1 produto (qty 2) = 3 usos da cota.
    expect(coveredItemQuantity(items)).toBe(3)
    // Só o produto baixa estoque, com a quantidade da linha.
    expect(coveredProducts(items)).toEqual([{ refId: 'prod-pomada', quantity: 2 }])
  })

  it('subscription: usage_incremented (cota = soma de itens cobertos) → replay == projeção', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/subscriptions/sub-1'
    const amount = coveredItemQuantity([COVERED_SERVICE, COVERED_PRODUCT])

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(SubscriptionConfig, path, {
          _tag: 'subscription.created',
          actorId: 'staff-1',
          payload: {
            id: 'sub-1',
            orgId: 't1',
            unitId: 'u1',
            customerId: 'c1',
            customerUserId: 'u-c1',
            planId: 'plan-1',
            plan: PLAN,
            periodStart: '2026-06-01T00:00:00.000Z',
            periodEnd: '2026-07-01T00:00:00.000Z',
            nextChargeDate: '2026-07-01T00:00:00.000Z',
            pastDueThreshold: 2,
          },
        })
        yield* appendEvent(SubscriptionConfig, path, {
          _tag: 'subscription.charge_settled',
          actorId: 'staff-1',
          payload: {},
        })
        yield* appendEvent(SubscriptionConfig, path, {
          _tag: 'subscription.usage_incremented',
          actorId: 'staff-1',
          payload: { amount },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(SubscriptionConfig, path).pipe(Effect.provide(layer)),
    )
    expect(replayed).toEqual(projection)
    expect(replayed.currentPeriod).toMatchObject({ consumed: 3 })
    expect(replayed.status).toBe('active')
  })

  it('catalog_item (produto): updated baixa estoque → replay == projeção', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/catalog_items/prod-pomada'
    const dec = coveredProducts([COVERED_PRODUCT])[0]!

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CatalogItemConfig, path, {
          _tag: 'catalog_item.created',
          actorId: 'staff-1',
          payload: {
            data: {
              id: 'prod-pomada',
              orgId: 't1',
              name: 'Pomada',
              kind: 'product',
              categoryId: 'cat-produtos',
              priceCents: 1500,
              commission: null,
              unitIds: ['u1'],
              unitOverrides: null,
              publicVisible: true,
              priceVisibility: 'visible',
              active: true,
              sku: null,
              stock: 10,
              gtin14: null,
              archivedAt: null,
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          },
        })
        // Decremento no fechamento da comanda (10 − 2 = 8).
        yield* appendEvent(CatalogItemConfig, path, {
          _tag: 'catalog_item.updated',
          actorId: 'staff-1',
          payload: { changes: { stock: 10 - dec.quantity } },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(CatalogItemConfig, path).pipe(Effect.provide(layer)),
    )
    expect(replayed).toEqual(projection)
    expect(isCatalogProduct(replayed)).toBe(true)
    if (isCatalogProduct(replayed)) expect(replayed.stock).toBe(8)
  })
})
