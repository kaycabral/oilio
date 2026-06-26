import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

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
import type { FirestoreDoc } from './services'
import { PersistencePort } from './services'

// ---------------------------------------------------------------------------
// Test aggregate: Counter
// ---------------------------------------------------------------------------

type CounterState = { readonly count: number; readonly _version: number }

const CounterEvent = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Incremented'), amount: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal('Reset') }),
)
type CounterEvent = typeof CounterEvent.Type

const CounterConfig: AggregateConfig<CounterState, CounterEvent> = {
  type: 'counter',
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

// ---------------------------------------------------------------------------
// Test Firestore layer (in-memory)
// ---------------------------------------------------------------------------

function makeStore(initial: Record<string, FirestoreDoc> = {}) {
  const store = new Map(Object.entries(initial))

  const layer = Layer.succeed(PersistencePort, {
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
  })

  return { store, layer }
}

const PATH = 'orgs/t1/counters/c1'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Event Store', () => {
  describe('appendEvent', () => {
    it('AC-01: appends event to subcollection and updates projection atomically', async () => {
      const { store, layer } = makeStore()

      await Effect.runPromise(
        appendEvent(CounterConfig, PATH, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 5 },
        }).pipe(Effect.provide(layer)),
      )

      const event = store.get(`${PATH}/events/v000001`)
      expect(event).toBeDefined()
      expect(event!['_tag']).toBe('Incremented')
      expect(event!['version']).toBe(1)
      expect(event!['actorId']).toBe('user-1')
      expect(event!['schemaVersion']).toBe(1)

      const projection = store.get(PATH)
      expect(projection).toBeDefined()
      expect(projection!['count']).toBe(5)
      expect(projection!['_version']).toBe(1)
    })

    it('AC-01: sequential appends increment version correctly', async () => {
      const { store, layer } = makeStore()

      const program = Effect.gen(function* () {
        yield* appendEvent(CounterConfig, PATH, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 3 },
        })
        yield* appendEvent(CounterConfig, PATH, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 7 },
        })
        yield* appendEvent(CounterConfig, PATH, {
          _tag: 'Reset',
          actorId: 'user-2',
          payload: {},
        })
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))

      expect(store.get(`${PATH}/events/v000001`)).toBeDefined()
      expect(store.get(`${PATH}/events/v000002`)).toBeDefined()
      expect(store.get(`${PATH}/events/v000003`)).toBeDefined()

      const projection = store.get(PATH)
      expect(projection!['count']).toBe(0)
      expect(projection!['_version']).toBe(3)
    })

    it('AC-04: rejects malformed event with EventValidationError', async () => {
      const { layer } = makeStore()

      const result = await Effect.runPromise(
        appendEvent(CounterConfig, PATH, {
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

      expect(result).toEqual({ caught: true, aggregateType: 'counter' })
    })

    it('AC-04: malformed event does not write anything to store', async () => {
      const { store, layer } = makeStore()

      await Effect.runPromise(
        appendEvent(CounterConfig, PATH, {
          _tag: 'Incremented',
          actorId: 'user-1',
          payload: { amount: 'bad' },
        }).pipe(
          Effect.catchTag('EventValidationError', () => Effect.void),
          Effect.provide(layer),
        ),
      )

      expect(store.size).toBe(0)
    })
  })

  describe('appendEventGuarded', () => {
    const guardReturning = (result: GuardResult) => () => Effect.succeed(result)

    it('ok: snapshots the guard payload into the event + projection', async () => {
      const { store, layer } = makeStore()

      const envelope = await Effect.runPromise(
        appendEventGuarded({
          config: CounterConfig,
          aggregatePath: PATH,
          actorId: 'user-1',
          tag: 'Incremented',
          guard: guardReturning({ _tag: 'ok', payload: { amount: 5 } }),
        }).pipe(Effect.provide(layer)),
      )

      expect(envelope.version).toBe(1)
      expect(store.get(`${PATH}/events/v000001`)).toMatchObject({ _tag: 'Incremented', version: 1 })
      expect(store.get(PATH)).toMatchObject({ count: 5, _version: 1 })
    })

    it('reject: fails with GuardRejectedError and writes nothing', async () => {
      const { store, layer } = makeStore()

      const result = await Effect.runPromise(
        appendEventGuarded({
          config: CounterConfig,
          aggregatePath: PATH,
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
    })

    it('invalid: fails with EventValidationError when the payload fails the schema', async () => {
      const { store, layer } = makeStore()

      const result = await Effect.runPromise(
        appendEventGuarded({
          config: CounterConfig,
          aggregatePath: PATH,
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

      expect(result).toEqual({ caught: true, aggregateType: 'counter' })
      expect(store.size).toBe(0)
    })
  })

  describe('buildInitialEvent', () => {
    it('returns the v1 envelope, eventId and projection for a valid first event', () => {
      const { envelope, eventId, projection } = buildInitialEvent(CounterConfig, {
        _tag: 'Incremented',
        actorId: 'user-1',
        payload: { amount: 4 },
      })

      expect(envelope.version).toBe(1)
      expect(eventId).toBe('v000001')
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
      const { store, layer } = makeStore()

      await Effect.runPromise(
        Effect.gen(function* () {
          yield* appendEvent(CounterConfig, PATH, {
            _tag: 'Incremented',
            actorId: 'u1',
            payload: { amount: 10 },
          })
          yield* appendEvent(CounterConfig, PATH, {
            _tag: 'Incremented',
            actorId: 'u1',
            payload: { amount: 5 },
          })
          yield* appendEvent(CounterConfig, PATH, {
            _tag: 'Reset',
            actorId: 'u2',
            payload: {},
          })
          yield* appendEvent(CounterConfig, PATH, {
            _tag: 'Incremented',
            actorId: 'u1',
            payload: { amount: 3 },
          })
        }).pipe(Effect.provide(layer)),
      )

      const projection = store.get(PATH)!
      const replayed = await Effect.runPromise(
        replayAggregate(CounterConfig, PATH).pipe(Effect.provide(layer)),
      )

      expect(replayed.count).toBe(projection['count'])
      expect(replayed._version).toBe(projection['_version'])
      expect(replayed).toEqual({ count: 3, _version: 4 })
    })

    it('AC-02: replay of empty aggregate returns initial state', async () => {
      const { layer } = makeStore()

      const replayed = await Effect.runPromise(
        replayAggregate(CounterConfig, PATH).pipe(Effect.provide(layer)),
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

      const { store, layer } = makeStore()

      store.set(`${PATH}/events/v000001`, {
        _tag: 'Incremented',
        version: 1,
        timestamp: '2026-06-01T10:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: { amount: 10 },
      })
      store.set(`${PATH}/events/v000002`, {
        _tag: 'Reset',
        version: 2,
        timestamp: '2026-06-01T11:00:00Z',
        actorId: 'u2',
        schemaVersion: 1,
        payload: {},
      })
      store.set(`${PATH}/events/v000003`, {
        _tag: 'Incremented',
        version: 3,
        timestamp: '2026-06-01T12:00:00Z',
        actorId: 'u1',
        schemaVersion: 2,
        payload: { amount: 7 },
      })

      const replayed = await Effect.runPromise(
        replayAggregate(configV2, PATH).pipe(Effect.provide(layer)),
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

      const { store, layer } = makeStore()

      store.set(`${PATH}/events/v000001`, {
        _tag: 'Incremented',
        version: 1,
        timestamp: '2026-06-01T10:00:00Z',
        actorId: 'u1',
        schemaVersion: 1,
        payload: { amount: 5 },
      })

      const replayed = await Effect.runPromise(
        replayAggregate(configV3, PATH).pipe(Effect.provide(layer)),
      )

      expect(replayed).toEqual({ count: 5, _version: 1 })
    })
  })
})
