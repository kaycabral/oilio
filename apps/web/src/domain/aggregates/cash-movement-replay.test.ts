// AC-09/AC-10 (brief 0025), fatia caixa (#1019) — caixa sem sessão (0015):
// o movimento de caixa é event-first (created carrega o snapshot completo,
// standalone, sem cashRegisterId). created → replay == projeção, campo a campo.

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { CashMovementConfig } from './cash-movement/config'

describe('CashMovement — replay reconstrói o doc completo (event-first)', () => {
  it('created (snapshot) → replay == projeção', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(CashMovementConfig, 't1', 'm1')
    const data = {
      id: 'm1',
      orgId: 't1',
      unitId: 'u1',
      kind: 'sale',
      direction: 'in',
      amountCents: 5000,
      paymentMethod: 'cash',
      description: null,
      orderId: 'o1',
      expenseCategoryId: null,
      recordedByUid: 'user-1',
      createdAt: '2026-06-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CashMovementConfig, ref, {
          _tag: 'cash_movement.created',
          actorId: 'user-1',
          payload: { data },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(CashMovementConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(1)
    expect(replayed.kind).toBe('sale')
    expect(replayed.amountCents).toBe(5000)
    expect(replayed.orderId).toBe('o1')
    expect(replayed.createdAt).toBe('2026-06-01T12:00:00.000Z')
  })
})
