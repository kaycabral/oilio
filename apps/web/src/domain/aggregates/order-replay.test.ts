// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo da comanda
// (event-first: criar/adicionar item/trocar atribuição/meta/remover/cancelar
// emitem evento, sem write-only). O ciclo de vida inteiro (menos fechamento,
// que é #1026) → replay == projeção, campo a campo.
//
// Brief 0030 (AC-04): a atribuição de item é por MEMBRO (`attributedUserId`,
// guarda o `userId` do membro) e o evento de troca é `order.item_attribution_changed`.

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { OrderConfig } from './order/config'

// Serviço de agendamento → atribuído ao `userId` do profissional do appointment.
const itemA = {
  id: 'i1',
  kind: 'service' as const,
  refId: 's1',
  name: 'Corte',
  quantity: 1,
  unitPriceCents: 5000,
  commission: null,
  attributedUserId: 'pro-user-1',
}
// Produto vendido no balcão → atribuível a QUALQUER membro pelo `userId` (aqui a
// recepção que vendeu), não a um doc id de Professional.
const itemB = {
  id: 'i2',
  kind: 'product' as const,
  refId: 'pr1',
  name: 'Pomada',
  quantity: 2,
  unitPriceCents: 1500,
  commission: null,
  attributedUserId: 'reception-user-1',
}

describe('Order — replay reconstrói o doc completo (event-first)', () => {
  it('created → item_added → attribution → meta → item_removed → cancelled → replay == projeção', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(OrderConfig, 't1', 'o1')
    const data = {
      id: 'o1',
      orgId: 't1',
      unitId: 'u1',
      customerId: 'c1',
      appointmentId: 'a1',
      status: 'open',
      items: [itemA],
      discountCents: 0,
      notes: null,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: 5000,
      totalCents: 5000,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.created',
          actorId: 'staff-1',
          payload: { data },
        })
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.item_added',
          actorId: 'staff-1',
          payload: { changes: { items: [itemA, itemB], subtotalCents: 8000, totalCents: 8000 } },
        })
        // Re-atribui o produto a outro membro (brief 0030, AC-04) — guarda o
        // `userId`, não um doc id de Professional.
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.item_attribution_changed',
          actorId: 'staff-1',
          payload: {
            changes: {
              items: [itemA, { ...itemB, attributedUserId: 'manager-user-2' }],
              subtotalCents: 8000,
              totalCents: 8000,
            },
          },
        })
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.meta_updated',
          actorId: 'staff-1',
          payload: { changes: { discountCents: 1000, totalCents: 7000, notes: 'cliente fiel' } },
        })
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.item_removed',
          actorId: 'staff-1',
          payload: { changes: { items: [itemA], subtotalCents: 5000, totalCents: 4000 } },
        })
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.cancelled',
          actorId: 'staff-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(OrderConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(6)
    expect(replayed.status).toBe('cancelled')
    expect(replayed.items).toHaveLength(1)
    // Atribuição por membro sobrevive ao replay (brief 0030, AC-04): o serviço
    // restante segue atribuído ao `userId` do profissional do agendamento.
    expect(replayed.items[0]!.attributedUserId).toBe('pro-user-1')
    expect(replayed.discountCents).toBe(1000)
    expect(replayed.totalCents).toBe(4000)
    expect(replayed.createdAt).toBe('2026-06-01T12:00:00.000Z')
  })

  it('item_coverage_changed projeta cobertura por item (brief 0021)', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(OrderConfig, 't1', 'o2')
    const data = {
      id: 'o2',
      orgId: 't1',
      unitId: 'u1',
      customerId: 'c1',
      appointmentId: null,
      status: 'open',
      items: [itemA],
      discountCents: 0,
      notes: null,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: 5000,
      totalCents: 5000,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.created',
          actorId: 'staff-1',
          payload: { data },
        })
        // itemA marcado como consumo de assinatura → some do total a pagar.
        yield* appendEvent(OrderConfig, ref, {
          _tag: 'order.item_coverage_changed',
          actorId: 'staff-1',
          payload: {
            changes: {
              items: [{ ...itemA, coverage: 'subscription', subscriptionId: 'sub1' }],
              subtotalCents: 0,
              totalCents: 0,
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(OrderConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    expect(replayed.items[0]!.coverage).toBe('subscription')
    expect(replayed.items[0]!.subscriptionId).toBe('sub1')
    expect(replayed.totalCents).toBe(0)
  })
})
