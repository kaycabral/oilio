import type { FirestoreDoc, PersistenceOps, QueryConstraint } from '@/domain/effect'
import { LoggerService, PersistencePort } from '@/domain/effect'
import { Effect, Layer } from 'effect'

export function makeTestFirestoreLayer(docs: Record<string, FirestoreDoc>) {
  const store = new Map(Object.entries(docs))

  const ops: PersistenceOps = {
    getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),

    getDocs: (collectionPath: string, _constraints?: readonly QueryConstraint[]) =>
      Effect.succeed(
        [...store.entries()]
          .filter(([key]) => key.startsWith(collectionPath + '/'))
          .map(([, doc]) => doc),
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
