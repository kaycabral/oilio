import type {
  AggregateRef,
  CollectionRef,
  FirestoreDoc,
  PersistenceOps,
  QueryConstraint,
} from '@/domain/effect'
import { LoggerService, PersistencePort } from '@/domain/effect'
import { Effect, Layer } from 'effect'

// In-memory store key for a single aggregate's projection (D6: keyed by the
// typed ref, no path string). `${type}/${orgId}/${id}` is the collision-free
// identity — the same triple the live layer keys its projection rows by.
export function docKey(ref: AggregateRef): string {
  return `${ref.type}/${ref.orgId}/${ref.id}`
}

// Collection prefix for a `getDocs` scope — every aggregate of `type` in `orgId`.
function collectionKey(ref: CollectionRef): string {
  return `${ref.type}/${ref.orgId}/`
}

/**
 * An in-memory `PersistencePort` for replay/saga unit tests (D6) — ref-keyed,
 * with a real per-aggregate event log so `replayAggregate(config, ref)` reads
 * back what `appendEvent`/`tx.appendEvent` wrote in the same run. Returns BOTH
 * the layer (to `Effect.provide`) and the live `store`/`events` maps (so a test
 * can assert the projection by ref). Replaces the bespoke inline `makeStore()`
 * fixtures every replay test used to hand-roll. Use `docKey(ref)` to read the
 * store in assertions.
 */
export function makeReplayStore(seed: Record<string, FirestoreDoc> = {}) {
  const store = new Map(Object.entries(seed))
  const events = new Map<string, FirestoreDoc[]>()

  const txCtx = {
    getDoc: (ref: AggregateRef) => Effect.succeed(store.get(docKey(ref)) ?? null),
    getDocForUpdate: (ref: AggregateRef) => Effect.succeed(store.get(docKey(ref)) ?? null),
    setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
      Effect.sync(() => {
        const key = docKey(ref)
        store.set(key, { ...store.get(key), ...data })
      }),
    appendEvent: (ref: AggregateRef, _version: number, envelope: FirestoreDoc) =>
      Effect.sync(() => {
        const key = docKey(ref)
        const log = events.get(key) ?? []
        log.push(envelope)
        events.set(key, log)
      }),
    deleteDoc: (ref: AggregateRef) =>
      Effect.sync(() => {
        store.delete(docKey(ref))
      }),
  }

  const ops: PersistenceOps = {
    getDoc: (ref: AggregateRef) => Effect.succeed(store.get(docKey(ref)) ?? null),
    getDocs: (ref: CollectionRef, _constraints?: readonly QueryConstraint[]) =>
      Effect.succeed(
        [...store.entries()]
          .filter(([key]) => key.startsWith(collectionKey(ref)))
          .map(([, doc]) => doc)
          .sort(
            (a, b) =>
              (typeof a['_version'] === 'number' ? a['_version'] : 0) -
              (typeof b['_version'] === 'number' ? b['_version'] : 0),
          ),
      ),
    getEvents: (ref: AggregateRef) => Effect.succeed([...(events.get(docKey(ref)) ?? [])]),
    setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
      Effect.sync(() => {
        const key = docKey(ref)
        store.set(key, { ...store.get(key), ...data })
      }),
    runTransaction: (fn) => fn(txCtx),
  }

  return { store, events, layer: Layer.succeed(PersistencePort, ops) }
}

export function makeTestFirestoreLayer(docs: Record<string, FirestoreDoc>) {
  // Projections keyed by `${type}/${orgId}/${id}` (see `docKey`); callers seed
  // with the same key so the in-memory store mirrors the typed projection table.
  const store = new Map(Object.entries(docs))
  // Per-aggregate event log keyed by `docKey`, so `getEvents` (replay) reads back
  // what `appendEvent` wrote in the same in-memory run.
  const events = new Map<string, FirestoreDoc[]>()

  const ops: PersistenceOps = {
    getDoc: (ref: AggregateRef) => Effect.succeed(store.get(docKey(ref)) ?? null),

    getDocs: (ref: CollectionRef, _constraints?: readonly QueryConstraint[]) =>
      Effect.succeed(
        [...store.entries()]
          .filter(([key]) => key.startsWith(collectionKey(ref)))
          .map(([, doc]) => doc),
      ),

    getEvents: (ref: AggregateRef) => Effect.succeed([...(events.get(docKey(ref)) ?? [])]),

    setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
      Effect.sync(() => {
        const key = docKey(ref)
        store.set(key, { ...store.get(key), ...data })
      }),

    runTransaction: (fn) =>
      fn({
        getDoc: (ref) => Effect.succeed(store.get(docKey(ref)) ?? null),
        setDoc: (ref, data) =>
          Effect.sync(() => {
            const key = docKey(ref)
            store.set(key, { ...store.get(key), ...data })
          }),
        appendEvent: (ref, _version, envelope) =>
          Effect.sync(() => {
            const key = docKey(ref)
            const log = events.get(key) ?? []
            log.push(envelope)
            events.set(key, log)
          }),
      }),
  }

  // Provide the single persistence port from the one in-memory store — mirrors
  // the live layer, so event-store effects (`replayAggregate`/`appendEvent`) and
  // projection reads both resolve in tests over `PersistencePort`.
  return Layer.succeed(PersistencePort, ops)
}

export const TestLoggerLayer = Layer.succeed(LoggerService, {
  info: () => Effect.void,
  error: () => Effect.void,
  warn: () => Effect.void,
})
