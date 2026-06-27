import type {
  AggregateRef,
  CollectionRef,
  FirestoreDoc,
  PersistenceOps,
  QueryConstraint,
  TransactionContext,
} from '@/domain/effect'
import { PersistencePort, SecurityContext } from '@/domain/effect'
import { Effect, Layer, Option } from 'effect'
import type { PoolClient } from 'pg'
import { setRlsGucs } from '../guc'
import { getEventStorePool } from '../pool'
import { readUnderRls } from '../rls-read'
// Side-effect imports: register the typed projectors in the typed-projection
// registry before the first projection write. catalog-item (brief 0058);
// org/unit/membership (identity, brief 0059); professional/customer/invite +
// category/subscription-plan + agenda-block/goal/notification (config, brief 0060);
// order/commission/cash-movement (financial core, brief 0061 § Grupo A).
import './agenda-block-projector'
import './appointment-projector'
import './cash-movement-projector'
import './catalog-item-projector'
import './category-projector'
import './charge-projector'
import './commission-projector'
import './customer-projector'
import './goal-projector'
import './invite-projector'
import './membership-projector'
import './notification-projector'
import './order-projector'
import './org-billing-projector'
import './org-projector'
import './professional-projector'
import './subscription-plan-projector'
import './subscription-projector'
import { typedProjectorFor } from './typed-projections'
import './unit-projector'

/**
 * Postgres-backed `PersistencePort` for the relational event store (brief 0057,
 * ADR 0012) — the sole backend after the cutover (#1202).
 *
 * D6 (ADR 0013): the port speaks typed identity (`AggregateRef`/`CollectionRef`),
 * not a Firestore path string:
 *   - projection:  `getDoc(ref)` / `setDoc(ref, state)`
 *   - event write: `tx.appendEvent(ref, version, envelope)`
 *   - stream read: `getEvents(ref)` (replay)
 *   - collection:  `getDocs({type, orgId}, constraints)`
 *
 * Events land in `events` (`aggregate_id` = `ref.id`, with `(aggregate_type,
 * org_id)` siblings → `UNIQUE(aggregate_type, org_id, aggregate_id, version)`
 * enforces optimistic concurrency in the DB); the projection lands in its typed
 * table (PK `(org_id, id)`) or the generic `projections` store; BOTH happen in
 * the SAME pg transaction — a rollback leaves zero rows in both. Reducers /
 * aggregates / envelope are unchanged: this is purely the substrate. The org/type
 * are explicit ref data — never re-parsed out of a string (no `orgIdOf`).
 */

// Reads an aggregate's projection: from its TYPED table when a projector is
// registered (so the event store sees the same state it wrote — versioning on
// append and rehydration on replay), else from the generic `projections` store.
async function getProjectionDoc(
  client: PoolClient,
  ref: AggregateRef,
): Promise<FirestoreDoc | null> {
  const typed = typedProjectorFor(ref.type)
  if (typed) {
    return typed.read(client, ref)
  }
  const res = await client.query<{ state: FirestoreDoc }>(
    'SELECT state FROM projections WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.state ?? null
}

// Like `getProjectionDoc` but takes a ROW LOCK (`FOR UPDATE`) on the projection
// row — the guarded-append definition read (brief 0033 AC-08). A concurrent
// reprice/discontinuation of the SAME definition (catalog-item / plan) blocks
// until this tx ends, so two guarded appends can't both snapshot a stale price.
// Typed definition projectors expose `readForUpdate`; everything else falls back
// to a locked read of the generic `projections` row.
async function getProjectionDocForUpdate(
  client: PoolClient,
  ref: AggregateRef,
): Promise<FirestoreDoc | null> {
  const typed = typedProjectorFor(ref.type)
  if (typed?.readForUpdate) {
    return typed.readForUpdate(client, ref)
  }
  const res = await client.query<{ state: FirestoreDoc }>(
    'SELECT state FROM projections WHERE org_id = $1 AND id = $2 FOR UPDATE',
    [ref.orgId, ref.id],
  )
  return res.rows[0]?.state ?? null
}

// Read an aggregate-type COLLECTION within an org the pure domain/cron passes to
// `getDocs` (a `CollectionRef`) — resolves the typed projector by `ref.type` and
// runs its `list` (constraint→SQL translation owned by the projector), scoped to
// `ref.orgId` under RLS via `readUnderRls`. An unsupported collection THROWS
// (loud), never a silent empty result. Platform-wide tenant enumeration does NOT
// come through here: the crons read the PUBLIC `public_org_directory` (no RLS, by
// contract) and then issue these org-scoped reads, so this is always under RLS.
async function readCollection(
  ref: CollectionRef,
  constraints: readonly QueryConstraint[],
): Promise<readonly FirestoreDoc[]> {
  const projector = typedProjectorFor(ref.type)
  if (!projector?.list) {
    throw new Error(`Unsupported collection read for "${ref.type}" (no typed list projector)`)
  }
  const list = projector.list
  return readUnderRls(ref.orgId, (client) => list(client, ref, constraints))
}

// Reads an aggregate's full event stream (version order) for replay.
async function readEventStream(
  client: PoolClient,
  ref: AggregateRef,
): Promise<readonly FirestoreDoc[]> {
  // The `envelope` JSONB is annotated (not asserted) as `FirestoreDoc` at this
  // single driver boundary; callers decode it against the schema (no cast in
  // product code). Scoped by the composite event identity (D6).
  const res = await client.query<{ envelope: FirestoreDoc }>(
    `SELECT envelope FROM events
     WHERE aggregate_type = $1 AND org_id = $2 AND aggregate_id = $3
     ORDER BY version ASC`,
    [ref.type, ref.orgId, ref.id],
  )
  return res.rows.map((row) => row.envelope)
}

async function writeEvent(
  client: PoolClient,
  ref: AggregateRef,
  version: number,
  envelope: FirestoreDoc,
): Promise<void> {
  // The DB enforces optimistic concurrency: a duplicate (aggregate_type, org_id,
  // aggregate_id, version) raises 23505 (unique_violation), which surfaces as a
  // failed transaction — the second concurrent append is refused by the DB, not
  // the app. `aggregate_id` is the bare aggregate id (D6); type/org are siblings.
  await client.query(
    `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
     VALUES ($1, $2, $3, $4, $5)`,
    [ref.type, ref.id, version, ref.orgId, envelope],
  )
}

// Writes the reduced state of an aggregate's projection: into its TYPED table
// when the context registered a typed projector (brief 0058, AC-03 — e.g.
// `catalog_items`), else into the generic `projections` JSONB store. Both run on
// the same `client`, so the projection commits or rolls back with its event.
async function upsertProjection(
  client: PoolClient,
  ref: AggregateRef,
  state: FirestoreDoc,
): Promise<void> {
  const typed = typedProjectorFor(ref.type)
  if (typed) {
    await typed.upsert(client, ref, state)
    return
  }
  // Merge-on-write mirrors Firestore's `set(..., {merge:true})`: the event store
  // writes the full reduced state, so a plain upsert of `state` is faithful.
  await client.query(
    `INSERT INTO projections (org_id, id, state, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (org_id, id)
     DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [ref.orgId, ref.id, state],
  )
}

/**
 * Hard-delete an aggregate's projection: from its TYPED table when a projector is
 * registered, else from the generic `projections` store. The event store skips
 * the projection write for `*.deleted` events (the caller hard-deletes), so the
 * row removal is driven by the backend-aware delete helper, which calls this.
 */
export async function deleteProjectionRow(client: PoolClient, ref: AggregateRef): Promise<void> {
  const typed = typedProjectorFor(ref.type)
  if (typed) {
    await typed.delete(client, ref)
    return
  }
  await client.query('DELETE FROM projections WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

const postgresOps: PersistenceOps = {
  getDoc: (ref: AggregateRef) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        return await getProjectionDoc(client, ref)
      } finally {
        client.release()
      }
    }),

  getDocs: (ref: CollectionRef, constraints?: readonly QueryConstraint[]) =>
    Effect.promise(async () => readCollection(ref, constraints ?? [])),

  getEvents: (ref: AggregateRef) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        return await readEventStream(client, ref)
      } finally {
        client.release()
      }
    }),

  setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        await upsertProjection(client, ref, data)
      } finally {
        client.release()
      }
    }),

  runTransaction: <A, E>(fn: (tx: TransactionContext) => Effect.Effect<A, E, never>) =>
    // Read the OPTIONAL `SecurityContext` (brief 0059): present at the request
    // edge, absent in low-level tooling. It supplies `app.current_unit` (and an
    // explicit org override); `app.current_org` otherwise comes from the
    // `AggregateRef.orgId` of the doc being touched (D6) — explicit typed data on
    // the ref, so the ~433 write call-sites thread NOTHING via the path.
    Effect.serviceOption(SecurityContext).pipe(
      Effect.flatMap((ctx) =>
        Effect.promise(async () => {
          const security = Option.getOrNull(ctx)
          const pool = getEventStorePool()
          const client = await pool.connect()
          // Set the per-transaction RLS GUCs exactly once, on the first ref the
          // tx touches (read or write). `SET LOCAL` is tx-scoped — it never leaks
          // back to the pooled connection. `app.current_org` comes from the ref
          // (or the explicit context override); `app.current_unit` from the
          // context (empty string = org-wide, the permissive unit predicate).
          // Latch only once the org GUC is actually set — the context override
          // (when provided) wins and is org-stable.
          let rlsSet = false
          const ensureRls = async (orgId: string | null): Promise<void> => {
            if (rlsSet) return
            const resolvedOrg = security?.orgId ?? orgId
            await setRlsGucs(client, resolvedOrg, security?.unitId ?? '')
            if (resolvedOrg !== null) rlsSet = true
          }
          try {
            await client.query('BEGIN')
            // The tx context reads/writes through the SAME client, so the event
            // row and its projection commit (or roll back) atomically — now under
            // RLS (the GUCs are set on the first touch, before any row is read or
            // written).
            const txCtx: TransactionContext = {
              getDoc: (ref: AggregateRef) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return getProjectionDoc(client, ref)
                }),
              // Locked read for the guarded-append definition read (AC-08) — see
              // `getProjectionDocForUpdate`. Same client/tx, so the FOR UPDATE
              // lock is held until this tx commits/rolls back.
              getDocForUpdate: (ref: AggregateRef) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return getProjectionDocForUpdate(client, ref)
                }),
              setDoc: (ref: AggregateRef, d: FirestoreDoc) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return upsertProjection(client, ref, d)
                }),
              // Appends one event row on the SAME client (D6) — `aggregate_id` =
              // `ref.id`, type/org as siblings. Commits/rolls back with the tx.
              appendEvent: (ref: AggregateRef, version: number, envelope: FirestoreDoc) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return writeEvent(client, ref, version, envelope)
                }),
              // Drops the projection row on the SAME client — commits/rolls back
              // with the rest of the tx. Used by the undo-close ACID saga.
              deleteDoc: (ref: AggregateRef) =>
                Effect.promise(async () => {
                  await ensureRls(ref.orgId)
                  return deleteProjectionRow(client, ref)
                }),
            }
            const result = await Effect.runPromise(fn(txCtx))
            await client.query('COMMIT')
            return result
          } catch (err) {
            // Any failure (a typed reject inside the Effect, a DB constraint such
            // as the UNIQUE on duplicate version, or an RLS policy refusal) rolls
            // back the whole transaction — never an event without its projection,
            // never a projection without its event.
            await client.query('ROLLBACK')
            throw err
          } finally {
            client.release()
          }
        }),
      ),
    ),
}

/**
 * The event store's `PersistencePort`, backed by Postgres — the sole backend
 * after the cutover (#1202). Events + projection in one ACID transaction.
 */
export const PostgresPersistenceLayer = Layer.succeed(PersistencePort, postgresOps)

/**
 * The Postgres live layer — the analogue of `FirestoreLayerLive` for the call
 * sites that provide a whole persistence backend (the notifications/reconcile
 * crons and the reactor dispatcher) after the cutover (brief 0062).
 *
 * `PersistencePort` is now the SINGLE persistence seam (services.ts): the event
 * store AND the general projection reads (notifications, units, customers,
 * subscriptions, catalog_items, orgs — translated to typed-table SQL by
 * `getDocs`) both run over this one port. So providing `PostgresPersistenceLayer`
 * fully backs those effects with Postgres — no separate Firestore-only service.
 */
export const PostgresLayerLive = PostgresPersistenceLayer

/**
 * Hard-delete a projection row in Postgres by aggregate path (brief 0058, AC-02).
 *
 * The event store keeps a `*.deleted` event in `events` but skips the projection
 * write (the caller hard-deletes the read-model doc). On Firestore the caller
 * does `.doc().delete()`; on Postgres it calls this — routed to the typed table
 * when a projector is registered (`catalog_items`), else the generic store. The
 * event row stays (history preserved); only the projection is removed. Kept
 * OUTSIDE `PersistencePort` so the port contract (the event-store seam) doesn't
 * reopen for a read-model concern (brief 0058, AC-03).
 *
 * Runs in a transaction with the RLS GUC set from `ref.orgId` (feature C): the
 * typed tables are under FORCE RLS, so a DELETE on a bare connection with no
 * `app.current_org` matches ZERO rows under the non-superuser runtime role —
 * silently orphaning the projection. The ref's org scopes the DELETE so it
 * actually removes the row.
 */
export async function deletePostgresProjection(ref: AggregateRef): Promise<void> {
  const pool = getEventStorePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setRlsGucs(client, ref.orgId, '')
    await deleteProjectionRow(client, ref)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
