import { Context, type Effect } from 'effect'

export type FirestoreDoc = Record<string, unknown>

// The document/collection persistence operations the app's Effect code runs
// over. After the Postgres cutover (brief 0062) `PersistencePort` is the SINGLE
// persistence seam — both the EVENT STORE (`replayAggregate`/`appendEvent`) and
// the general projection READS (notifications, availability, reconcile, …) run
// over this one port, backed by Postgres (event + projection in one ACID tx).
export type PersistenceOps = {
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

/**
 * The single persistence port the app's Effect code runs over (brief 0057/0062,
 * ADR 0012). A transactional `getDoc`/`setDoc` plus stream `getDocs`: the event
 * store (`replayAggregate`/`appendEvent`) and the projection reads both yield
 * this Tag. Backed by Postgres (event + projection in one ACID tx) post-cutover.
 */
export class PersistencePort extends Context.Tag('PersistencePort')<
  PersistencePort,
  PersistenceOps
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
  // Reads a projection doc WITHIN the transaction with a ROW LOCK (Postgres
  // `SELECT … FOR UPDATE`) — the guarded-append definition read (brief 0033
  // AC-08): a concurrent discontinuation/reprice of the SAME definition blocks
  // until this tx commits/rolls back, closing the TOCTOU window that a plain
  // read leaves open (a lock-free read lets two appends snapshot a stale price).
  // OPTIONAL so the in-memory `TransactionContext`s the replay tests build stay
  // valid; the guard falls back to `getDoc` when absent (single-process tests
  // have no concurrency to serialize). A real backend always provides it.
  readonly getDocForUpdate?: (path: string) => Effect.Effect<FirestoreDoc | null, never, never>
  readonly setDoc: (path: string, data: FirestoreDoc) => Effect.Effect<void, never, never>
  // Hard-deletes a projection doc WITHIN the transaction — used by a saga that
  // reverses an aggregate it created (e.g. undo-close removing the commissions it
  // generated) so the row removal commits or rolls back atomically with the rest
  // of the cascade (brief 0061 § Grupo A / AC-02). The event row is never deleted
  // (history is append-only); only the read-model projection is dropped.
  //
  // OPTIONAL so the lightweight in-memory `TransactionContext`s the replay tests
  // build (getDoc/setDoc only) stay valid — a saga that deletes must run over a
  // real layer (Firestore/Postgres), which always provides it.
  readonly deleteDoc?: (path: string) => Effect.Effect<void, never, never>
}

/**
 * The request's security identity — the single source the Postgres RLS reads to
 * scope a session to its org/unit (brief 0059, feature C). Resolved once at the
 * request edge (org from `getActiveOrgContext`, unit from the active-unit
 * cookie) and provided to the event-store Effect.
 *
 * Design (hybrid, by-decision): the WRITE path derives `app.current_org` from the
 * aggregate PATH inside `runTransaction` (the org is a pure function of the doc
 * being written — impossible to desync, no parameter threaded through the ~100
 * `emitEvent` call-sites), so this Tag is read OPTIONALLY there. The `unitId`
 * (not in the path) and the backend-aware READS (which run outside the tx) are
 * what genuinely need this Tag — they set `app.current_unit`/`app.current_org`
 * from it. Absent context → org-only scoping (the unit predicate is permissive),
 * never a silent cross-org leak (the org GUC is always set on the write path).
 */
export class SecurityContext extends Context.Tag('SecurityContext')<
  SecurityContext,
  { readonly orgId: string; readonly unitId: string | null }
>() {}

export class LoggerService extends Context.Tag('LoggerService')<
  LoggerService,
  {
    readonly info: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly error: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly warn: (message: string, data?: Record<string, unknown>) => Effect.Effect<void>
  }
>() {}
