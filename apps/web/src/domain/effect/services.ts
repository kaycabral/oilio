import { Context, type Effect } from 'effect'

import type { AggregateRef, CollectionRef } from './aggregate-ref'

export type FirestoreDoc = Record<string, unknown>

export type PersistenceOps = {
  readonly getDoc: (ref: AggregateRef) => Effect.Effect<FirestoreDoc | null, never, never>
  readonly getDocs: (
    ref: CollectionRef,
    constraints?: readonly QueryConstraint[],
  ) => Effect.Effect<readonly FirestoreDoc[], never, never>
  readonly getEvents: (ref: AggregateRef) => Effect.Effect<readonly FirestoreDoc[], never, never>
  readonly setDoc: (ref: AggregateRef, data: FirestoreDoc) => Effect.Effect<void, never, never>
  readonly runTransaction: <A, E>(
    fn: (tx: TransactionContext) => Effect.Effect<A, E, never>,
  ) => Effect.Effect<A, E, never>
}

export class PersistencePort extends Context.Tag('PersistencePort')<
  PersistencePort,
  PersistenceOps
>() {}

export type FirestoreWhereOp =
  '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any'

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
  readonly getDoc: (ref: AggregateRef) => Effect.Effect<FirestoreDoc | null, never, never>
  readonly getDocForUpdate?: (ref: AggregateRef) => Effect.Effect<FirestoreDoc | null, never, never>
  readonly setDoc: (ref: AggregateRef, data: FirestoreDoc) => Effect.Effect<void, never, never>
  readonly appendEvent?: (
    ref: AggregateRef,
    version: number,
    envelope: FirestoreDoc,
  ) => Effect.Effect<void, never, never>
  readonly deleteDoc?: (ref: AggregateRef) => Effect.Effect<void, never, never>
}

export class SecurityContext extends Context.Tag('SecurityContext')<
  SecurityContext,
  {
    readonly orgId: string
    readonly unitId: string | null
    readonly memberOperationId?: string | null
  }
>() {}

export class LoggerService extends Context.Tag('LoggerService')<
  LoggerService,
  {
    readonly info: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly error: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly warn: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
  }
>() {}
