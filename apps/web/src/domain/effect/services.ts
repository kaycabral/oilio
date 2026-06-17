import { Context, type Effect } from 'effect'

export type FirestoreDoc = Record<string, unknown>

export class FirestoreService extends Context.Tag('FirestoreService')<
  FirestoreService,
  {
    readonly getDoc: (path: string) => Effect.Effect<FirestoreDoc | null, never, never>
    readonly getDocs: (
      collectionPath: string,
      constraints?: readonly QueryConstraint[],
    ) => Effect.Effect<readonly FirestoreDoc[], never, never>
    readonly setDoc: (path: string, data: FirestoreDoc) => Effect.Effect<void, never, never>
    readonly runTransaction: <A, E>(
      fn: (tx: TransactionContext) => Effect.Effect<A, E, never>,
    ) => Effect.Effect<A, E, never>
  }
>() {}

// Mirrors Firestore's `WhereFilterOp` literal union (kept here in the pure
// kernel so the live layer passes `op` straight to `q.where` without a cast).
export type FirestoreWhereOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not-in'
  | 'array-contains'
  | 'array-contains-any'

export type QueryConstraint =
  | {
      readonly kind: 'where'
      readonly field: string
      readonly op: FirestoreWhereOp
      readonly value: unknown
    }
  | { readonly kind: 'orderBy'; readonly field: string; readonly direction: 'asc' | 'desc' }
  | { readonly kind: 'limit'; readonly count: number }

export type TransactionContext = {
  readonly getDoc: (path: string) => Effect.Effect<FirestoreDoc | null, never, never>
  readonly setDoc: (path: string, data: FirestoreDoc) => Effect.Effect<void, never, never>
}

export class LoggerService extends Context.Tag('LoggerService')<
  LoggerService,
  {
    readonly info: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly error: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly warn: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
  }
>() {}
