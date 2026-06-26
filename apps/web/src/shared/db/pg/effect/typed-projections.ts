import type { AggregateRef, CollectionRef, FirestoreDoc, QueryConstraint } from '@/domain/effect'
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
 * The registry is keyed by the aggregate's `AggregateType` (the `config.type`,
 * e.g. `catalog_item`) — D6 (ADR 0013): the router looks the projector up by the
 * ref's typed `type`, not by parsing a path segment. A registered context routes
 * to its typed table; an org-neutral aggregate falls back to the generic
 * `projections` store. This is the seam the typed projectors plug into without
 * reopening the `PersistencePort` — adding a context is registering a projector,
 * not changing the port contract.
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
  readonly read: (client: PoolClient, ref: AggregateRef) => Promise<FirestoreDoc | null>
  /**
   * Like `read` but takes a ROW LOCK (`SELECT … FOR UPDATE`) — the guarded-append
   * definition read (brief 0033 AC-08). Optional: implemented by the definition
   * projectors a price/availability guard reads (catalog-item, subscription-plan)
   * so a concurrent reprice/discontinuation serializes against the append. The
   * Postgres layer falls back to a locked generic `projections` read when absent.
   */
  readonly readForUpdate?: (client: PoolClient, ref: AggregateRef) => Promise<FirestoreDoc | null>
  /** Project the reduced `state` (the reducer's output) into the typed table. */
  readonly upsert: (client: PoolClient, ref: AggregateRef, state: FirestoreDoc) => Promise<void>
  /** Drop the typed row for an aggregate (hard-delete). */
  readonly delete: (client: PoolClient, ref: AggregateRef) => Promise<void>
  /**
   * Scan an aggregate-type collection within an org that the pure domain/cron
   * reads through `PersistencePort.getDocs` (a {@link CollectionRef}), translating
   * the domain `QueryConstraint[]` to SQL and mapping each row to the reducer's doc
   * shape via `rowToDoc`. Optional: only the projectors a collection read actually
   * targets implement it (the Postgres Layer throws a loud error for an unsupported
   * collection). Org-scoped tables filter on `ref.orgId` under RLS.
   */
  readonly list?: (
    client: PoolClient,
    ref: CollectionRef,
    constraints: readonly QueryConstraint[],
  ) => Promise<FirestoreDoc[]>
}

const registry = new Map<AggregateRef['type'], TypedProjector>()

/**
 * Register a typed projector for an aggregate `type`. Idempotent per type
 * (last registration wins) so module re-evaluation in tests doesn't accumulate.
 */
export function registerTypedProjector(
  type: AggregateRef['type'],
  projector: TypedProjector,
): void {
  registry.set(type, projector)
}

/** The typed projector for an aggregate `type`, or `undefined` (use the generic store). */
export function typedProjectorFor(type: AggregateRef['type']): TypedProjector | undefined {
  return registry.get(type)
}
