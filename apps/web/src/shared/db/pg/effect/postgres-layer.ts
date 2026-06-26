import type {
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
 * The event store talks to the port in a path vocabulary (a legacy of the
 * Firestore origin, kept as the neutral key shape):
 *   - projection doc:  `getDoc(aggregatePath)` / `setDoc(aggregatePath, state)`
 *   - event write:     `setDoc('{aggregatePath}/events/v000001', envelope)`
 *   - stream read:     `getDocs('{aggregatePath}/events', [orderBy version])`
 *
 * This layer translates that vocabulary to the relational schema: events land in
 * `events` (UNIQUE(aggregate_id, version) → optimistic concurrency enforced by
 * the DB), the projection lands in `projections` (keyed by the aggregate path),
 * and BOTH happen in the SAME pg transaction — a rollback leaves zero rows in
 * both. Reducers/aggregates/envelope are unchanged: this is purely the substrate.
 */

const EVENT_PATH = /^(?<aggregatePath>.+)\/events\/v(?<version>\d+)$/
const EVENTS_COLLECTION = /^(?<aggregatePath>.+)\/events$/

// `aggregate_type` is the aggregate-type segment of the path — the
// second-to-last segment (e.g. `orgs/{org}/orders/{id}` → `orders`,
// `product_events/{id}` → `product_events`). `aggregate_id` is the full
// aggregate path (globally unique).
function aggregateTypeOf(aggregatePath: string): string {
  const segments = aggregatePath.split('/')
  return segments.length >= 2 ? segments[segments.length - 2]! : aggregatePath
}

// The org an aggregate path belongs to — the source of `app.current_org` on the
// RLS write path (feature C). Two shapes carry the org:
//   - `orgs/{orgId}/…` (and `orgs/{orgId}`) → the second segment.
//   - `memberships/{orgId}_{userId}` (TOP-LEVEL — memberships resolve the
//     user↔org link) → the org is the doc-id prefix before the `_{userId}`
//     suffix. The membership table is under RLS too, so without this a membership
//     tx runs with NO `app.current_org` and fail-closes (the read returns the
//     INITIAL state → an empty `user_id` write → CHECK refusal). Split on the
//     LAST `_`, not the first: a Firebase uid is `[A-Za-z0-9]` (no underscore),
//     while an org id may contain `_`, so the last `_` is always the id↔uid
//     boundary.
// Everything else (cross-org/system aggregates) → null.
function orgIdOf(aggregatePath: string): string | null {
  const segments = aggregatePath.split('/')
  if (segments[0] === 'orgs' && segments[1]) return segments[1]
  if (segments[0] === 'memberships' && segments[1]) {
    const lastUnderscore = segments[1].lastIndexOf('_')
    return lastUnderscore > 0 ? segments[1].slice(0, lastUnderscore) : null
  }
  return null
}

// Reads an aggregate's projection: from its TYPED table when a projector is
// registered (so the event store sees the same state it wrote — versioning on
// append and rehydration on replay), else from the generic `projections` store.
async function getProjectionDoc(
  client: PoolClient,
  aggregatePath: string,
): Promise<FirestoreDoc | null> {
  const typed = typedProjectorFor(aggregateTypeOf(aggregatePath))
  if (typed) {
    return typed.read(client, aggregatePath)
  }
  const res = await client.query<{ state: FirestoreDoc }>(
    'SELECT state FROM projections WHERE aggregate_path = $1',
    [aggregatePath],
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
  aggregatePath: string,
): Promise<FirestoreDoc | null> {
  const typed = typedProjectorFor(aggregateTypeOf(aggregatePath))
  if (typed?.readForUpdate) {
    return typed.readForUpdate(client, aggregatePath)
  }
  const res = await client.query<{ state: FirestoreDoc }>(
    'SELECT state FROM projections WHERE aggregate_path = $1 FOR UPDATE',
    [aggregatePath],
  )
  return res.rows[0]?.state ?? null
}

// Read a COLLECTION the pure domain/cron passes to `getDocs` (e.g.
// `orgs/{orgId}/notifications`) — NOT an event stream. Resolves the typed
// projector by the collection's LAST segment (= the table's `aggregate_type`),
// then runs its `list` (constraint→SQL translation owned by the projector),
// scoped to the path's org under RLS via `readUnderRls`. An unsupported
// collection — or one without an org context — THROWS (loud), never a silent
// empty result. Platform-wide tenant enumeration does NOT come through here: the
// crons read the PUBLIC `public_org_directory` (no RLS, by contract) and then
// issue these org-scoped reads, so this path is always under an org's RLS.
async function readCollection(
  collectionPath: string,
  constraints: readonly QueryConstraint[],
): Promise<readonly FirestoreDoc[]> {
  const segments = collectionPath.split('/')
  const collection = segments[segments.length - 1]!
  const projector = typedProjectorFor(collection)
  if (!projector?.list) {
    throw new Error(`Unsupported collection read for "${collectionPath}" (no typed list projector)`)
  }
  const list = projector.list
  const orgId = segments[0] === 'orgs' && segments.length > 1 ? segments[1]! : null
  if (orgId === null) {
    throw new Error(
      `Collection read "${collectionPath}" has no org context (RLS would fail closed)`,
    )
  }
  return readUnderRls(orgId, (client) => list(client, collectionPath, constraints))
}

async function writeEvent(
  client: PoolClient,
  aggregatePath: string,
  version: number,
  envelope: FirestoreDoc,
): Promise<void> {
  // The DB enforces optimistic concurrency: a duplicate (aggregate_id, version)
  // raises 23505 (unique_violation), which surfaces as a failed transaction —
  // the second concurrent append is refused by the DB, not the app.
  await client.query(
    `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
     VALUES ($1, $2, $3, $4, $5)`,
    [aggregateTypeOf(aggregatePath), aggregatePath, version, orgIdOf(aggregatePath), envelope],
  )
}

// Writes the reduced state of an aggregate's projection: into its TYPED table
// when the context registered a typed projector (brief 0058, AC-03 — e.g.
// `catalog_items`), else into the generic `projections` JSONB store. Both run on
// the same `client`, so the projection commits or rolls back with its event.
async function upsertProjection(
  client: PoolClient,
  aggregatePath: string,
  state: FirestoreDoc,
): Promise<void> {
  const typed = typedProjectorFor(aggregateTypeOf(aggregatePath))
  if (typed) {
    await typed.upsert(client, aggregatePath, state)
    return
  }
  // Merge-on-write mirrors Firestore's `set(..., {merge:true})`: the event store
  // writes the full reduced state, so a plain upsert of `state` is faithful.
  await client.query(
    `INSERT INTO projections (aggregate_path, state, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (aggregate_path)
     DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [aggregatePath, state],
  )
}

/**
 * Hard-delete an aggregate's projection: from its TYPED table when a projector is
 * registered, else from the generic `projections` store. The event store skips
 * the projection write for `*.deleted` events (the caller hard-deletes), so the
 * row removal is driven by the backend-aware delete helper, which calls this.
 */
export async function deleteProjectionRow(
  client: PoolClient,
  aggregatePath: string,
): Promise<void> {
  const typed = typedProjectorFor(aggregateTypeOf(aggregatePath))
  if (typed) {
    await typed.delete(client, aggregatePath)
    return
  }
  await client.query('DELETE FROM projections WHERE aggregate_path = $1', [aggregatePath])
}

// Routes a `setDoc(path, data)` to the right table by the path shape: an
// `…/events/vNNN` path is an event append; anything else is a projection write.
async function routeSetDoc(client: PoolClient, path: string, data: FirestoreDoc): Promise<void> {
  const eventMatch = EVENT_PATH.exec(path)
  if (eventMatch?.groups) {
    const { aggregatePath, version } = eventMatch.groups
    await writeEvent(client, aggregatePath!, Number(version), data)
    return
  }
  await upsertProjection(client, path, data)
}

const postgresOps: PersistenceOps = {
  getDoc: (path: string) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        return await getProjectionDoc(client, path)
      } finally {
        client.release()
      }
    }),

  getDocs: (collectionPath: string, constraints?: readonly QueryConstraint[]) =>
    Effect.promise(async () => {
      const eventsMatch = EVENTS_COLLECTION.exec(collectionPath)
      if (!eventsMatch?.groups) {
        // Not an event stream → a general COLLECTION read (notifications, units,
        // customers, subscriptions, catalog_items, top-level orgs) the pure
        // domain/cron passes. Translate it to the typed table's SQL under RLS.
        return readCollection(collectionPath, constraints ?? [])
      }
      const aggregatePath = eventsMatch.groups.aggregatePath!
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        // Replay reads the aggregate's stream in version order — the constraint
        // the event store always passes (`orderBy version asc`) is the ONLY read
        // shape, so it is applied unconditionally (backed by the events index).
        // The `envelope` JSONB is annotated (not asserted) as `FirestoreDoc` at
        // this single driver boundary — the same pattern the Firestore layer
        // uses; callers decode it against the schema (no cast in product code).
        const res = await client.query<{ envelope: FirestoreDoc }>(
          'SELECT envelope FROM events WHERE aggregate_id = $1 ORDER BY version ASC',
          [aggregatePath],
        )
        return res.rows.map((row) => row.envelope)
      } finally {
        client.release()
      }
    }),

  setDoc: (path: string, data: FirestoreDoc) =>
    Effect.promise(async () => {
      const pool = getEventStorePool()
      const client = await pool.connect()
      try {
        await routeSetDoc(client, path, data)
      } finally {
        client.release()
      }
    }),

  runTransaction: <A, E>(fn: (tx: TransactionContext) => Effect.Effect<A, E, never>) =>
    // Read the OPTIONAL `SecurityContext` (brief 0059): present at the request
    // edge, absent in low-level tooling. It supplies `app.current_unit` (and an
    // explicit org override); `app.current_org` otherwise derives from the
    // aggregate path being touched — a pure function of the write target, so the
    // ~100 `emitEvent` call-sites thread NOTHING (hybrid design).
    Effect.serviceOption(SecurityContext).pipe(
      Effect.flatMap((ctx) =>
        Effect.promise(async () => {
          const security = Option.getOrNull(ctx)
          const pool = getEventStorePool()
          const client = await pool.connect()
          // Set the per-transaction RLS GUCs exactly once, on the first path the
          // tx touches (read or write). `SET LOCAL` is tx-scoped — it never leaks
          // back to the pooled connection. `app.current_org` derives from the
          // path (or the explicit context override); `app.current_unit` from the
          // context (empty string = org-wide, the permissive unit predicate).
          // Latch only once the org GUC is actually set — if the first touched
          // path resolves to a null org (a system/probe aggregate), keep trying on
          // later touches so an org-scoped write further in the tx still gets its
          // scope. The context override (when provided) wins and is org-stable.
          let rlsSet = false
          const ensureRls = async (path: string): Promise<void> => {
            if (rlsSet) return
            const orgId = security?.orgId ?? orgIdOf(path)
            await setRlsGucs(client, orgId, security?.unitId ?? '')
            if (orgId !== null) rlsSet = true
          }
          try {
            await client.query('BEGIN')
            // The tx context reads/writes through the SAME client, so the event
            // row and its projection commit (or roll back) atomically — now under
            // RLS (the GUCs are set on the first touch, before any row is read or
            // written).
            const txCtx: TransactionContext = {
              getDoc: (p: string) =>
                Effect.promise(async () => {
                  await ensureRls(p)
                  return getProjectionDoc(client, p)
                }),
              // Locked read for the guarded-append definition read (AC-08) — see
              // `getProjectionDocForUpdate`. Same client/tx, so the FOR UPDATE
              // lock is held until this tx commits/rolls back.
              getDocForUpdate: (p: string) =>
                Effect.promise(async () => {
                  await ensureRls(p)
                  return getProjectionDocForUpdate(client, p)
                }),
              setDoc: (p: string, d: FirestoreDoc) =>
                Effect.promise(async () => {
                  await ensureRls(p)
                  return routeSetDoc(client, p, d)
                }),
              // Drops the projection row on the SAME client — commits/rolls back
              // with the rest of the tx. Used by the undo-close ACID saga.
              deleteDoc: (p: string) =>
                Effect.promise(async () => {
                  await ensureRls(p)
                  return deleteProjectionRow(client, p)
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
 * Runs in a transaction with the RLS GUC set from the aggregate path (feature C):
 * the typed tables are under FORCE RLS, so a DELETE on a bare connection with no
 * `app.current_org` matches ZERO rows under the non-superuser runtime role —
 * silently orphaning the projection. Deriving the org from the path (like
 * `runTransaction`) scopes the DELETE so it actually removes the row.
 */
export async function deletePostgresProjection(aggregatePath: string): Promise<void> {
  const pool = getEventStorePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setRlsGucs(client, orgIdOf(aggregatePath), '')
    await deleteProjectionRow(client, aggregatePath)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
