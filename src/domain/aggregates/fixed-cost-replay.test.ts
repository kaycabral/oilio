import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { FixedCostConfig } from './fixed-cost/config'

const BASE = {
  id: 'fc-1',
  orgId: 't1',
  unitId: 'unit1',
  seriesId: 'series-1',
  name: 'Aluguel',
  category: 'expense_admin' as const,
  amountCents: 200000,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
  archivedAt: null,
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
}

describe('FixedCost — replay reconstrói o doc completo (event-first)', () => {
  it('created → superseded fecha a vigência (não-retroação, AC-02)', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(FixedCostConfig, 't1', 'fc-1')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(FixedCostConfig, ref, {
          _tag: 'fixed_cost.created',
          actorId: 'actor-1',
          payload: { data: BASE },
        })
        yield* appendEvent(FixedCostConfig, ref, {
          _tag: 'fixed_cost.superseded',
          actorId: 'actor-1',
          payload: { effectiveTo: '2026-07-01T00:00:00.000Z' },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(FixedCostConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    expect(replayed.amountCents).toBe(200000)
    expect(replayed.effectiveTo).toBe('2026-07-01T00:00:00.000Z')
  })

  it('rename via update não abre vigência (AC-02)', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(FixedCostConfig, 't1', 'fc-2')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(FixedCostConfig, ref, {
          _tag: 'fixed_cost.created',
          actorId: 'actor-1',
          payload: { data: { ...BASE, id: 'fc-2' } },
        })
        yield* appendEvent(FixedCostConfig, ref, {
          _tag: 'fixed_cost.updated',
          actorId: 'actor-1',
          payload: { changes: { name: 'Aluguel Centro', category: 'expense_commercial' } },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(FixedCostConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed).toEqual(projection)
    expect(replayed.name).toBe('Aluguel Centro')
    expect(replayed.category).toBe('expense_commercial')
    expect(replayed.effectiveTo).toBeNull()
  })

  it('archived faz soft-delete preservando o histórico (AC-04)', async () => {
    const { layer } = makeReplayStore()
    const ref = aggregateRef(FixedCostConfig, 't1', 'fc-3')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(FixedCostConfig, ref, {
          _tag: 'fixed_cost.created',
          actorId: 'actor-1',
          payload: { data: { ...BASE, id: 'fc-3' } },
        })
        yield* appendEvent(FixedCostConfig, ref, {
          _tag: 'fixed_cost.archived',
          actorId: 'actor-1',
          payload: { archivedAt: '2026-08-01T00:00:00.000Z' },
        })
      }).pipe(Effect.provide(layer)),
    )

    const replayed = await Effect.runPromise(
      replayAggregate(FixedCostConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed._version).toBe(2)
    expect(replayed.archivedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(replayed.amountCents).toBe(200000)
  })
})
