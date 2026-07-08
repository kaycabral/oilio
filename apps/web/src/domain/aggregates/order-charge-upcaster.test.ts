import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { replayAggregate } from '../effect/event-store'
import { ChargeConfig } from './charge/config'
import { OrderConfig } from './order/config'

// O PRIMEIRO upcaster registrado do codebase (order/charge, v1→v2, ADR 0016 D5).
// oilio ESTÁ em produção (verificado no GCP), então um bump de schemaVersion num
// campo persistido exige upcaster — senão o replay de um evento v1 legado decodifica
// contra o schema v2 e quebra (ou dropa o campo). Estes testes provam que um evento
// v1 persistido sobe pra v2 no replay, com o neutral correto.

describe('Order upcaster v1→v2 (order.closed +items, order.reopened +campos)', () => {
  it('order.closed v1 (sem items) replaya sob v2 preenchendo items: []', async () => {
    const { events, layer } = makeReplayStore()
    const ref = aggregateRef(OrderConfig, 't1', 'o1')
    events.set(docKey(ref), [
      {
        _tag: 'order.created',
        version: 1,
        timestamp: '2026-05-01T10:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: {
          data: {
            id: 'o1',
            orgId: 't1',
            unitId: 'u1',
            customerId: null,
            appointmentId: null,
            status: 'open',
            items: [],
            discountCents: 0,
            closedAt: null,
            paymentMethod: null,
            subtotalCents: 0,
            totalCents: 0,
            createdAt: '2026-05-01T10:00:00Z',
            updatedAt: '2026-05-01T10:00:00Z',
          },
        },
      },
      {
        // v1 shape: NO `items` on the closed event (pre-D5).
        _tag: 'order.closed',
        version: 2,
        timestamp: '2026-05-01T12:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: {
          closedAt: '2026-05-01T12:00:00Z',
          subtotalCents: 0,
          totalCents: 0,
          paymentMethod: 'cash',
        },
      },
    ])

    // Replays without throwing: the upcaster fills `items: []` so the v2 decode
    // passes. A pre-D5 closed order simply contributes no per-item revenue.
    const replayed = await Effect.runPromise(
      replayAggregate(OrderConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed.status).toBe('closed')
    expect(replayed.closedAt).toBe('2026-05-01T12:00:00Z')
    expect(replayed._version).toBe(2)
  })

  it('order.reopened v1 (sem reopenedAt/reversedClosedAt) replaya sob v2 com neutrals', async () => {
    const { events, layer } = makeReplayStore()
    const ref = aggregateRef(OrderConfig, 't1', 'o2')
    events.set(docKey(ref), [
      {
        _tag: 'order.created',
        version: 1,
        timestamp: '2026-05-01T10:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: {
          data: {
            id: 'o2',
            orgId: 't1',
            unitId: 'u1',
            customerId: null,
            appointmentId: null,
            status: 'open',
            items: [],
            discountCents: 0,
            closedAt: null,
            paymentMethod: null,
            subtotalCents: 0,
            totalCents: 0,
            createdAt: '2026-05-01T10:00:00Z',
            updatedAt: '2026-05-01T10:00:00Z',
          },
        },
      },
      {
        _tag: 'order.closed',
        version: 2,
        timestamp: '2026-05-01T12:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: {
          closedAt: '2026-05-01T12:00:00Z',
          subtotalCents: 0,
          totalCents: 0,
          paymentMethod: 'cash',
        },
      },
      {
        // v1 shape: NO reopenedAt / reversedClosedAt (pre-D5).
        _tag: 'order.reopened',
        version: 3,
        timestamp: '2026-05-02T09:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: {
          commissionsReversed: 0,
          cashReversalMovementId: null,
          subscriptionRestored: false,
        },
      },
    ])

    const replayed = await Effect.runPromise(
      replayAggregate(OrderConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed.status).toBe('open')
    expect(replayed._version).toBe(3)
  })
})

describe('Charge upcaster v1→v2 (charge.created +refundedAt)', () => {
  it('charge.created v1 (sem refundedAt) replaya sob v2 preenchendo refundedAt: null', async () => {
    const { events, layer } = makeReplayStore()
    const ref = aggregateRef(ChargeConfig, 't1', 'ch1')
    events.set(docKey(ref), [
      {
        _tag: 'charge.created',
        version: 1,
        timestamp: '2026-05-01T10:00:00Z',
        actorId: 'system',
        schemaVersion: 1,
        payload: {
          data: {
            id: 'ch1',
            orgId: 't1',
            unitId: 'u1',
            subscriptionId: 's1',
            customerId: 'c1',
            amountCents: 9900,
            periodStartAt: '2026-05-01T00:00:00Z',
            periodEndAt: '2026-06-01T00:00:00Z',
            dueDate: '2026-05-01T00:00:00Z',
            status: 'scheduled',
            attempts: 0,
            paidAt: null,
            failedAt: null,
            failureReason: null,
            // NO refundedAt (pre-D5).
            lastActorUid: null,
            createdAt: '2026-05-01T10:00:00Z',
            updatedAt: '2026-05-01T10:00:00Z',
          },
        },
      },
    ])

    const replayed = await Effect.runPromise(
      replayAggregate(ChargeConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed.status).toBe('scheduled')
    expect(replayed.refundedAt).toBeNull()
    expect(replayed._version).toBe(1)
  })
})
