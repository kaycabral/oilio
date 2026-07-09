import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { GoalConfig } from './goal/config'

async function checkReplay(
  id: string,
  data: Record<string, unknown>,
  changes: Record<string, unknown>,
): Promise<FirestoreDoc> {
  const { store, layer } = makeReplayStore()
  const ref = aggregateRef(GoalConfig, 't1', id)

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(GoalConfig, ref, {
        _tag: 'goal.defined',
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(GoalConfig, ref, {
        _tag: 'goal.updated',
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(docKey(ref))!
  const replayed = await Effect.runPromise(
    replayAggregate(GoalConfig, ref).pipe(Effect.provide(layer)),
  )

  expect(replayed).toEqual(projection)
  expect(replayed._version).toBe(2)
  return projection
}

describe('Goal — replay reconstructs the full doc (event-first)', () => {
  it('define a profit goal, then edit the target — replay == projection', async () => {
    const doc = await checkReplay(
      'profit__unit-a__2026-06',
      {
        id: 'profit__unit-a__2026-06',
        orgId: 't1',
        unitId: 'unit-a',
        period: '2026-06',
        type: 'profit',
        targetCents: 500_000,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      { targetCents: 750_000 },
    )

    expect(doc['targetCents']).toBe(750_000)
    expect(doc['unitId']).toBe('unit-a')
    expect(doc['period']).toBe('2026-06')
    expect(doc['type']).toBe('profit')
  })

  it('defined snapshot stands on its own (no edit) — version 1 projects fully', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(GoalConfig, 't1', 'profit__unit-b__2026-07')

    await Effect.runPromise(
      appendEvent(GoalConfig, ref, {
        _tag: 'goal.defined',
        actorId: 'actor-1',
        payload: {
          data: {
            id: 'profit__unit-b__2026-07',
            orgId: 't1',
            unitId: 'unit-b',
            period: '2026-07',
            type: 'profit',
            targetCents: 1_200_000,
            createdAt: '2026-07-01T12:00:00.000Z',
            updatedAt: '2026-07-01T12:00:00.000Z',
          },
        },
      }).pipe(Effect.provide(layer)),
    )

    const replayed = await Effect.runPromise(
      replayAggregate(GoalConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed).toEqual(store.get(docKey(ref)))
    expect(replayed._version).toBe(1)
    expect(replayed.targetCents).toBe(1_200_000)
  })
})
