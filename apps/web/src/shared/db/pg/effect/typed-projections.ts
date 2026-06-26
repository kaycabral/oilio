import type { FirestoreDoc, QueryConstraint } from '@/domain/effect'
import type { PoolClient } from 'pg'

/**
 * Typed-projection routing for the Postgres Layer (migration feature B, brief
 * 0058, AC-03).
 *
 * The foundation (feature A) routed every non-event `setDoc` to the generic
 * `projections` JSONB table. Feature B introduces a per-context mechanism: a
 * bounded context can register a *typed projector* that writes the reduced state
 * into its own richly-constrained table (e.g. `catalog_items`) — in the SAME
 * transaction as the event — instead of the generic store.
 *
 * The registry is keyed by `aggregate_type` (the aggregate-type segment of the
 * event-store path, e.g. `catalog_items`). The Postgres Layer looks the projector
 * up per write: a registered context routes to its typed table; an org-neutral
 * aggregate falls back to the generic `projections` store. This is the seam the
 * typed projectors plug into without reopening the `PersistencePort` — adding a
 * context is registering a projector, not changing the port contract.
 *
 * A projector exposes `read` (reconstruct the reduced state from the typed row),
 * `upsert` (project the reduced state) and `delete` (drop the row on a
 * hard-delete). `read` is the inverse of `upsert`: the event store's
 * `getDoc`/`tx.getDoc` (used to compute the next version on append and to
 * rehydrate on replay) must see the typed row, not the empty generic store, or
 * it would mis-version a second event. The event store skips the projection
 * write for `*.deleted` events (the caller hard-deletes the doc), so the typed
 * table's row removal is driven by the backend-aware delete helper, which calls
 * `delete` here. All three run on the SAME `PoolClient` the layer hands them, so
 * the typed read/write is consistent and atomic with its event.
 */
export type TypedProjector = {
  /** Reconstruct the reduced state (the reducer's doc shape) from the typed row, or null. */
  readonly read: (client: PoolClient, aggregatePath: string) => Promise<FirestoreDoc | null>
  /**
   * Like `read` but takes a ROW LOCK (`SELECT … FOR UPDATE`) — the guarded-append
   * definition read (brief 0033 AC-08). Optional: implemented by the definition
   * projectors a price/availability guard reads (catalog-item, subscription-plan)
   * so a concurrent reprice/discontinuation serializes against the append. The
   * Postgres layer falls back to a locked generic `projections` read when absent.
   */
  readonly readForUpdate?: (
    client: PoolClient,
    aggregatePath: string,
  ) => Promise<FirestoreDoc | null>
  /** Project the reduced `state` (the reducer's output) into the typed table. */
  readonly upsert: (client: PoolClient, aggregatePath: string, state: FirestoreDoc) => Promise<void>
  /** Drop the typed row for an aggregate path (hard-delete). */
  readonly delete: (client: PoolClient, aggregatePath: string) => Promise<void>
  /**
   * Scan the collection the pure domain/cron reads through `PersistencePort.getDocs`
   * (e.g. `orgs/{orgId}/notifications`), translating the domain `QueryConstraint[]`
   * to SQL and mapping each row to the reducer's doc shape via `rowToDoc`. Optional:
   * only the projectors a collection read actually targets implement it (the
   * Postgres Layer throws a loud error for an unsupported collection). `org-scoped`
   * tables filter on the path's org under RLS; a top-level scan (`orgs`) does not.
   */
  readonly list?: (
    client: PoolClient,
    collectionPath: string,
    constraints: readonly QueryConstraint[],
  ) => Promise<FirestoreDoc[]>
}

const registry = new Map<string, TypedProjector>()

/**
 * Register a typed projector for an `aggregate_type`. Idempotent per type
 * (last registration wins) so module re-evaluation in tests doesn't accumulate.
 */
export function registerTypedProjector(aggregateType: string, projector: TypedProjector): void {
  registry.set(aggregateType, projector)
}

/** The typed projector for an `aggregate_type`, or `undefined` (use the generic store). */
export function typedProjectorFor(aggregateType: string): TypedProjector | undefined {
  return registry.get(aggregateType)
}
