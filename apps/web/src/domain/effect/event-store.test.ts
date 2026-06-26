import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from './aggregate-ref'
import {
  appendEvent,
  appendEventGuarded,
  buildInitialEvent,
  EventValidationError,
  replayAggregate,
  type AggregateConfig,
  type EventEnvelope,
  type GuardResult,
} from './event-store'

// ---------------------------------------------------------------------------
// Test aggregate: Counter (modeled on a real `AggregateType` — `goal` — so the
// typed ref/config contract holds; the domain logic is a synthetic counter).
// ---------------------------------------------------------------------------

type CounterState = { readonly count: number; readonly _version: number }

const CounterEvent = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Incremented'), amount: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal('Reset') }),
)
type CounterEvent = typeof CounterEvent.Type

const CounterConfig: AggregateConfig<CounterState, CounterEvent> = {
  type: 'goal',
  initialState: { count: 0, _version: 0 },
  reducer: (state, event, meta) => {
    switch (event._tag) {
      case 'Incremented':
        return {
          count: state.count + event.amount,
          _version: meta.version,
        }
      case 'Reset':
        return { count: 0, _version: meta.version }
    }
  },
  schema: CounterEvent,
  currentSchemaVersion: 1,
}

const ref = aggregateRef(CounterConfig, 't1', 'c1')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Event Store', () => {
  describe('appendEvent', () => {
    it('AC-01: appends event to subcollection and updates projection atomically', async () => {
      const { store, events, layer } = makeReplayStore()

      await Effect.runPromise(
        appendEvent(CounterConfig, ref, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 5 },
        }).pipe(Effect.provide(layer)),
      )

      const log = events.get(docKey(ref))!
      const event = log[0]
      expect(event).toBeDefined()
      expect(event!['_tag']).toBe('Incremented')
      expect(event!['version']).toBe(1)
      expect(event!['actorId']).toBe('user-1')
      expect(event!['schemaVersion']).toBe(1)

      const projection = store.get(docKey(ref))
      expect(projection).toBeDefined()
      expect(projection!['count']).toBe(5)
      expect(projection!['_version']).toBe(1)
    })

    it('AC-01: sequential appends increment version correctly', async () => {
      const { store, events, layer } = makeReplayStore()

      const program = Effect.gen(function* () {
        yield* appendEvent(CounterConfig, ref, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 3 },
        })
        yield* appendEvent(CounterConfig, ref, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 7 },
        })
        yield* appendEvent(CounterConfig, ref, {
          _tag: 'Reset',
          actorId: 'user-2',
          payload: {},
        })
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))

      const log = events.get(docKey(ref)) ?? []
      expect(log.map((e) => e['version'])).toEqual([1, 2, 3])

      const projection = store.get(docKey(ref))
      expect(projection!['count']).toBe(0)
      expect(projection!['_version']).toBe(3)
    })

    it('AC-04: rejects malformed event with EventValidationError', async () => {
      const { layer } = makeReplayStore()

      const result = await Effect.runPromise(
        appendEvent(CounterConfig, ref, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 'not-a-number' },
        }).pipe(
          Effect.catchTag('EventValidationError', (e) =>
            Effect.succeed({ caught: true, aggregateType: e.aggregateType }),
          ),
          Effect.provide(layer),
        ),
      )

      expect(result).toEqual({ caught: true, aggregateType: 'goal' })
    })

    it('AC-04: malformed event does not write anything to store', async () => {
      const { store, events, layer } = makeReplayStore()

      await Effect.runPromise(
        appendEvent(CounterConfig, ref, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 'bad' },
        }).pipe(
          Effect.catchTag('EventValidationError', () => Effect.void),
          Effect.provide(layer),
        ),
      )

      expect(store.size).toBe(0)
      expect(events.size).toBe(0)
    })
  })

  describe('appendEventGuarded', () => {
    const guardReturning = (result: GuardResult) => () => Effect.succeed(result)

    it('ok: snapshots the guard payload into the event + projection', async () => {
      const { store, events, layer } = makeReplayStore()

      const envelope = await Effect.runPromise(
        appendEventGuarded({
          config: CounterConfig,
          ref,
          actorId: 'user-1',
          tag: 'Incremented',
          guard: guardReturning({ _tag: 'ok', payload: { amount: 5 } }),
        }).pipe(Effect.provide(layer)),
      )

      expect(envelope.version).toBe(1)
      expect(events.get(docKey(ref))![0]).toMatchObject({ _tag: 'Incremented', version: 1 })
      expect(store.get(docKey(ref))).toMatchObject({ count: 5, _version: 1 })
    })

    it('reject: fails with GuardRejectedError and writes nothing', async () => {
      const { store, events, layer } = makeReplayStore()

      const result = await Effect.runPromise(
        appendEventGuarded({
          config: CounterConfig,
          ref,
          actorId: 'user-1',
          tag: 'Incremented',
          guard: guardReturning({ _tag: 'reject', message: 'blocked' }),
        }).pipe(
          Effect.catchTag('GuardRejectedError', (e) =>
            Effect.succeed({ caught: true, message: e.message }),
          ),
          Effect.provide(layer),
        ),
      )

      expect(result).toEqual({ caught: true, message: 'blocked' })
      expect(store.size).toBe(0)
      expect(events.size).toBe(0)
    })

    it('invalid: fails with EventValidationError when the payload fails the schema', async () => {
      const { store, events, layer } = makeReplayStore()

      const result = await Effect.runPromise(
        appendEventGuarded({
          config: CounterConfig,
          ref,
          actorId: 'user-1',
          tag: 'Incremented',
          guard: guardReturning({ _tag: 'ok', payload: { amount: 'not-a-number' } }),
        }).pipe(
          Effect.catchTag('EventValidationError', (e) =>
            Effect.succeed({ caught: true, aggregateType: e.aggregateType }),
          ),
          Effect.provide(layer),
        ),
      )

      expect(result).toEqual({ caught: true, aggregateType: 'goal' })
      expect(store.size).toBe(0)
      expect(events.size).toBe(0)
    })
  })

  describe('buildInitialEvent', () => {
    it('returns the v1 envelope and projection for a valid first event', () => {
      const { envelope, projection } = buildInitialEvent(CounterConfig, {
        _tag: 'Incremented',
        actorId: 'user-1',
        payload: { amount: 4 },
      })

      expect(envelope.version).toBe(1)
      expect(projection).toEqual({ count: 4, _version: 1 })
    })

    it('throws EventValidationError when the first event fails the schema', () => {
      expect(() =>
        buildInitialEvent(CounterConfig, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 'bad' },
        }),
      ).toThrow(EventValidationError)
    })
  })

  describe('replayAggregate', () => {
    it('AC-02: replay reconstructs state identical to projection', async () => {
      const { store, layer } = makeReplayStore()

      await Effect.runPromise(
        Effect.gen(function* () {
          yield* appendEvent(CounterConfig, ref, {
            _tag: 'Incremented',
            actorId: 'u1',
            payload: { amount: 10 },
          })
          yield* appendEvent(CounterConfig, ref, {
            _tag: 'Incremented',
            actorId: 'u1',
            payload: { amount: 5 },
          })
          yield* appendEvent(CounterConfig, ref, {
            _tag: 'Reset',
            actorId: 'u2',
            payload: {},
          })
          yield* appendEvent(CounterConfig, ref, {
            _tag: 'Incremented',
            actorId: 'u1',
            payload: { amount: 3 },
          })
        }).pipe(Effect.provide(layer)),
      )

      const projection = store.get(docKey(ref))!
      const replayed = await Effect.runPromise(
        replayAggregate(CounterConfig, ref).pipe(Effect.provide(layer)),
      )

      expect(replayed.count).toBe(projection['count'])
      expect(replayed._version).toBe(projection['_version'])
      expect(replayed).toEqual({ count: 3, _version: 4 })
    })

    it('AC-02: replay of empty aggregate returns initial state', async () => {
      const { layer } = makeReplayStore()

      const replayed = await Effect.runPromise(
        replayAggregate(CounterConfig, ref).pipe(Effect.provide(layer)),
      )

      expect(replayed).toEqual({ count: 0, _version: 0 })
    })
  })

  describe('upcasters', () => {
    it('AC-03: upcaster converts v1 events during replay', async () => {
      const configV2: AggregateConfig<CounterState, CounterEvent> = {
        ...CounterConfig,
        currentSchemaVersion: 2,
        upcasters: {
          1: (envelope: EventEnvelope): EventEnvelope => ({
            ...envelope,
            schemaVersion: 2,
            payload:
              envelope._tag === 'Reset'
                ? { ...envelope.payload, reason: 'unknown' }
                : envelope.payload,
          }),
        },
      }

      const { events, layer } = makeReplayStore()

      events.set(docKey(ref), [
        {
          _tag: 'Incremented',
          version: 1,
          timestamp: '2026-06-01T10:00:00Z',
          actorId: 'u1',
          schemaVersion: 1,
          payload: { amount: 10 },
        },
        {
          _tag: 'Reset',
          version: 2,
          timestamp: '2026-06-01T11:00:00Z',
          actorId: 'u2',
          schemaVersion: 1,
          payload: {},
        },
        {
          _tag: 'Incremented',
          version: 3,
          timestamp: '2026-06-01T12:00:00Z',
          actorId: 'u1',
          schemaVersion: 2,
          payload: { amount: 7 },
        },
      ])

      const replayed = await Effect.runPromise(
        replayAggregate(configV2, ref).pipe(Effect.provide(layer)),
      )

      expect(replayed).toEqual({ count: 7, _version: 3 })
    })

    it('AC-03: chained upcasters v1→v2→v3', async () => {
      const configV3: AggregateConfig<CounterState, CounterEvent> = {
        ...CounterConfig,
        currentSchemaVersion: 3,
        upcasters: {
          1: (e: EventEnvelope): EventEnvelope => ({
            ...e,
            schemaVersion: 2,
            payload: { ...e.payload, v2Added: true },
          }),
          2: (e: EventEnvelope): EventEnvelope => ({
            ...e,
            schemaVersion: 3,
            payload: { ...e.payload, v3Added: true },
          }),
        },
      }

      const { events, layer } = makeReplayStore()

      events.set(docKey(ref), [
        {
          _tag: 'Incremented',
          version: 1,
          timestamp: '2026-06-01T10:00:00Z',
          actorId: 'u1',
          schemaVersion: 1,
          payload: { amount: 5 },
        },
      ])

      const replayed = await Effect.runPromise(
        replayAggregate(configV3, ref).pipe(Effect.provide(layer)),
      )

      expect(replayed).toEqual({ count: 5, _version: 1 })
    })
  })
})
