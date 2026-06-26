// AC-09/AC-10 (brief 0025), fatia charge (#1025) — gateway-gated: converge o
// domínio + replay + unit agora; o E2E desses fluxos espera a parceria ligar o
// gateway. created (snapshot scheduled) → failed (recovering) → succeeded
// (paid) → replay == projeção, campo a campo.

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { ChargeConfig } from './charge/config'

describe('Charge — replay reconstrói o doc completo (event-first, gateway-gated)', () => {
  it('created (scheduled) → failed (recovering) → succeeded (paid) → replay == projeção', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(ChargeConfig, 't1', 'ch1')
    const data = {
      id: 'ch1',
      orgId: 't1',
      unitId: 'unit-a',
      subscriptionId: 'sub1',
      customerId: 'c1',
      amountCents: 9900,
      periodStartAt: '2026-06-01T00:00:00.000Z',
      periodEndAt: '2026-07-01T00:00:00.000Z',
      dueDate: '2026-06-01T00:00:00.000Z',
      status: 'scheduled',
      attempts: 0,
      paidAt: null,
      failedAt: null,
      failureReason: null,
      lastActorUid: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(ChargeConfig, ref, {
          _tag: 'charge.created',
          actorId: 'system',
          payload: { data },
        })
        yield* appendEvent(ChargeConfig, ref, {
          _tag: 'charge.failed',
          actorId: 'system:webhook',
          payload: {
            changes: {
              status: 'recovering',
              attempts: 1,
              failedAt: '2026-07-01T03:00:00.000Z',
              failureReason: 'card_declined',
            },
          },
        })
        yield* appendEvent(ChargeConfig, ref, {
          _tag: 'charge.succeeded',
          actorId: 'system:webhook',
          payload: {
            changes: {
              status: 'paid',
              attempts: 2,
              paidAt: '2026-07-02T10:00:00.000Z',
              failedAt: null,
              failureReason: null,
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(ChargeConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(3)
    expect(replayed.status).toBe('paid')
    expect(replayed.attempts).toBe(2)
    expect(replayed.paidAt).toBe('2026-07-02T10:00:00.000Z')
    expect(replayed.amountCents).toBe(9900)
    // unitId (snapshot do ciclo, brief 0043 AC-02) sobrevive ao replay.
    expect(replayed.unitId).toBe('unit-a')
  })
})
