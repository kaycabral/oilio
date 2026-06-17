import type { FirestoreDoc, QueryConstraint } from '@/domain/effect'
import { FirestoreService, LoggerService } from '@/domain/effect'
import { Effect, Layer } from 'effect'

export function makeTestFirestoreLayer(docs: Record<string, FirestoreDoc>) {
  const store = new Map(Object.entries(docs))

  return Layer.succeed(FirestoreService, {
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
  })
}

export const TestLoggerLayer = Layer.succeed(LoggerService, {
  info: () => Effect.void,
  error: () => Effect.void,
  warn: () => Effect.void,
})
