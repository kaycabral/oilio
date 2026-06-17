import type { FirestoreDoc, QueryConstraint, TransactionContext } from '@/domain/effect'
import { FirestoreService } from '@/domain/effect'
import { Effect, Layer } from 'effect'
import { getAdminFirestore } from '../index'

function applyConstraints(
  ref: FirebaseFirestore.Query,
  constraints: readonly QueryConstraint[],
): FirebaseFirestore.Query {
  let q = ref
  for (const c of constraints) {
    switch (c.kind) {
      case 'where':
        q = q.where(c.field, c.op, c.value)
        break
      case 'orderBy':
        q = q.orderBy(c.field, c.direction)
        break
      case 'limit':
        q = q.limit(c.count)
        break
    }
  }
  return q
}

export const FirestoreLayerLive = Layer.succeed(FirestoreService, {
  getDoc: (path: string) =>
    Effect.promise(async () => {
      const snap = await getAdminFirestore().doc(path).get()
      if (!snap.exists) return null
      // `DocumentData` has `any` values; annotating (not asserting) narrows them
      // to `unknown` at this single SDK boundary — callers decode via schema.
      const data: Record<string, unknown> = snap.data() ?? {}
      return { id: snap.id, ...data }
    }),

  getDocs: (collectionPath: string, constraints?: readonly QueryConstraint[]) =>
    Effect.promise(async () => {
      let ref: FirebaseFirestore.Query = getAdminFirestore().collection(collectionPath)
      if (constraints) ref = applyConstraints(ref, constraints)
      const snap = await ref.get()
      return snap.docs.map((d) => {
        const data: Record<string, unknown> = d.data()
        return { id: d.id, ...data }
      })
    }),

  setDoc: (path: string, data: FirestoreDoc) =>
    Effect.promise(async () => {
      await getAdminFirestore().doc(path).set(data, { merge: true })
    }),

  runTransaction: <A, E>(fn: (tx: TransactionContext) => Effect.Effect<A, E, never>) =>
    Effect.promise(async () => {
      const db = getAdminFirestore()
      return db.runTransaction(async (firestoreTx) => {
        const txCtx: TransactionContext = {
          getDoc: (p: string) =>
            Effect.promise(async () => {
              const snap = await firestoreTx.get(db.doc(p))
              if (!snap.exists) return null
              const data: Record<string, unknown> = snap.data() ?? {}
              return { id: snap.id, ...data }
            }),
          setDoc: (p: string, d: FirestoreDoc) =>
            Effect.sync(() => {
              firestoreTx.set(db.doc(p), d, { merge: true })
            }),
        }
        return Effect.runPromise(fn(txCtx))
      })
    }),
})
