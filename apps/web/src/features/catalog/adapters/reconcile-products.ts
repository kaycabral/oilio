import { CatalogItemConfig } from '@/domain/aggregates'
import type { EventValidationError } from '@/domain/effect'
import { appendEvent, PersistencePort } from '@/domain/effect'
import { listAllOrgIds } from '@/shared/db/pg/public-org-directory'
import { resolveGate } from '@/shared/product'
import { Effect, Option, Schema } from 'effect'

// Reconciliation cron (brief 0050, AC-08). When the sovereign base was
// unavailable during a product's registration, the item was saved with its
// GTIN-14 guarded and `reconciliationPending: true` (the best-effort invariant,
// #1151). This generator reprocesses those markers once the base is back:
// re-resolve the GTIN (hit → reference; miss → auto-contribute), then clear the
// marker. Guarantees no valid GTIN stays orphaned (no `Product` AND no marker).
//
// PER-ITEM TOLERANT (mirrors `generateDailyNotifications`): one item that still
// can't reach the base — or whose update fails — does NOT abort the sweep; it is
// left pending for the next pass and the cron counts only the resolved items.
//
// IDEMPOTENT: re-running does not duplicate — auto-contribution is idempotent by
// the GTIN-14 UNIQUE key (A1), and an item whose marker was already cleared no
// longer matches the `reconciliationPending == true` query.

// Only the fields reconciliation needs off a pending catalog item.
const PendingItemDoc = Schema.Struct({
  id: Schema.String,
  gtin14: Schema.NullOr(Schema.String),
})

/**
 * Reprocess all pending reconciliation markers across every org. Returns the
 * number of items reconciled (marker cleared). `now` is injectable for tests.
 */
export function reconcilePendingProducts(
  now: Date = new Date(),
): Effect.Effect<number, never, PersistencePort> {
  return Effect.gen(function* () {
    const persistence = yield* PersistencePort
    // Enumerate tenants from the PUBLIC directory (no RLS) — a platform-wide
    // sweep can't read the RLS-guarded `orgs` table under a NOBYPASSRLS runtime
    // role. Each org's items below are read org-scoped (RLS enforced) as usual.
    const orgIds = yield* Effect.promise(() => listAllOrgIds())
    let reconciled = 0

    for (const orgId of orgIds) {
      if (!orgId) continue

      const pendingDocs = yield* persistence.getDocs(`orgs/${orgId}/catalog_items`, [
        { kind: 'where', field: 'reconciliationPending', op: '==', value: true },
      ])

      for (const raw of pendingDocs) {
        // Each item is processed in isolation: a malformed doc, a base still
        // down, or a failed marker write affects ONLY that item — never aborts
        // the sweep (the per-item-tolerant invariant). `reconcileOne` folds every
        // failure (typed error AND defect, incl. a decode die) into `false`.
        const ok = yield* reconcileOne(orgId, raw, now)
        if (ok) reconciled++
      }
    }

    return reconciled
  })
}

/**
 * Reconcile a single pending item. Returns `true` iff its marker was cleared.
 * Total: catches the typed error channel AND any defect (e.g. a `decodeAs` die
 * on a malformed doc) so one bad item can never abort the whole sweep.
 */
function reconcileOne(
  orgId: string,
  raw: unknown,
  now: Date,
): Effect.Effect<boolean, never, PersistencePort> {
  return Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(PendingItemDoc)(raw)
    if (Option.isNone(decoded) || !decoded.value.id) return false
    const item = decoded.value

    // A pending marker with no GTIN is nothing to reconcile — clear it so it
    // doesn't loop forever (defensive; the gate only sets the marker WITH a valid
    // GTIN).
    if (!item.gtin14) {
      yield* clearMarker(orgId, item.id, null, now)
      return true
    }

    // Re-resolve against the base. If it is STILL down, `resolveGate` throws →
    // the outer catch leaves the marker for the next pass (tolerant).
    const outcome = yield* Effect.promise(() => resolveGate(item.gtin14 ?? '').catch(() => null))
    if (outcome === null) return false

    // Resolved (referenced/contributed): store the canonical GTIN-14. On the
    // (unexpected) skip — a key that was valid at the gate but is now rejected —
    // KEEP the stored reference rather than erasing it; only the marker clears.
    const resolvedGtin = outcome.kind === 'skipped' ? item.gtin14 : outcome.gtin14
    yield* clearMarker(orgId, item.id, resolvedGtin, now)
    return true
  }).pipe(
    // Marker write failed (or any other typed error / defect) → leave the item
    // pending for the next pass; do not count it, do not abort the sweep.
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.catchAllDefect(() => Effect.succeed(false)),
  )
}

/** Clear the reconciliation marker on an item (event-sourced `updated`). */
function clearMarker(
  orgId: string,
  itemId: string,
  gtin14: string | null,
  now: Date,
): Effect.Effect<void, EventValidationError, PersistencePort> {
  return appendEvent(CatalogItemConfig, `orgs/${orgId}/catalog_items/${itemId}`, {
    _tag: 'catalog_item.updated',
    actorId: 'system:cron-reconcile',
    payload: {
      changes: {
        gtin14,
        reconciliationPending: false,
        reconciliationLastAttempt: now.toISOString(),
      },
    },
  }).pipe(Effect.asVoid)
}
