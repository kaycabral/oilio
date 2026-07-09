import type {
  AggregateRef,
  CollectionRef,
  FirestoreDoc,
  PersistenceOps,
  QueryConstraint,
} from '@/domain/effect'
import { LoggerService, PersistencePort } from '@/domain/effect'
import { Effect, Layer } from 'effect'

export function docKey(ref: AggregateRef): string {
  return `${ref.type}/${ref.orgId}/${ref.id}`
}

function collectionKey(ref: CollectionRef): string {
  return `${ref.type}/${ref.orgId}/`
}

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
  const store = new Map(Object.entries(docs))
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

  return Layer.succeed(PersistencePort, ops)
}

export const TestLoggerLayer = Layer.succeed(LoggerService, {
  info: () => Effect.void,
  error: () => Effect.void,
  warn: () => Effect.void,
})
