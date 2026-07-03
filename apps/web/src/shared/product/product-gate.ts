import { logger } from '@/shared/lib/logger'
import { resolveProduct, validateGtin } from '@cbrl/product'
import 'server-only'
import { emitProductEvent } from './product-events'
import { getProductSource } from './product-source'

// The sovereign-base gate that runs at catalog REGISTRATION (brief 0050, AC-05),
// never at sale. It resolves a raw GTIN against the base — referencing a known
// product or auto-contributing a valid+unseen one — and tells the caller which
// `gtin14` to stash on the `CatalogProductItem` (a reference, invisible in UX).
//
// Best-effort (#1151) layers ON TOP of this in `runProductGate`: this module's
// `resolveGate` is the path that ASSUMES the base is reachable; the caller wraps
// it so a Postgres outage degrades to a reconciliation marker instead of failing
// the registration.

/** Outcome the caller stores on the item. `gtin14` is the key to reference (or
 * null when the GTIN was rejected / absent). */
export type ProductGateResult =
  | { readonly kind: 'referenced'; readonly gtin14: string }
  | { readonly kind: 'contributed'; readonly gtin14: string }
  | { readonly kind: 'skipped' }

/**
 * Resolve a raw GTIN against the sovereign base and emit engine telemetry.
 * THROWS on a real infrastructure failure (DB down) — the best-effort wrapper
 * catches that; a rejected GTIN is a typed `skipped`, never a throw.
 */
export async function resolveGate(
  rawGtin: string,
  attrs: { name?: string } = {},
): Promise<ProductGateResult> {
  const startedAt = Date.now()
  const outcome = await resolveProduct(getProductSource(), rawGtin, attrs)
  const latencyMs = Date.now() - startedAt

  if (outcome.kind === 'skipped') {
    return { kind: 'skipped' }
  }

  await emitProductEvent({
    event: 'product_lookup',
    gtin14: outcome.gtin14,
    result: outcome.kind === 'referenced' ? 'hit' : 'miss',
    source: outcome.product.source,
    latencyMs,
  })
  if (outcome.kind === 'contributed') {
    await emitProductEvent({
      event: 'product_autocontributed',
      gtin14: outcome.gtin14,
      source: 'org-contributed',
    })
  }

  return { kind: outcome.kind, gtin14: outcome.gtin14 }
}

/** Fields the gate contributes to a `CatalogProductItem` at creation. The
 * reconciliation marker is set ONLY on the deferred (base-unavailable) path. */
export type ProductGateFields = {
  readonly gtin14: string | null
  readonly reconciliationPending?: boolean
  readonly reconciliationLastAttempt?: string
}

/**
 * Run the registration gate for a product's raw GTIN and return the fields to
 * merge onto the item — BEST-EFFORT (brief 0050, AC-06/AC-07). The sovereign
 * base is NEVER on the critical path of registration:
 *
 *   - base reachable, GTIN valid  → reference/contribute; store the GTIN-14.
 *   - base reachable, GTIN absent/invalid → store nothing (gtin14 null).
 *   - base UNAVAILABLE (Postgres down/slow) + GTIN valid → do NOT throw: store
 *     the normalized GTIN-14 (validated locally, no DB) + a reconciliation
 *     marker, and emit `product_contribution_deferred`. The cron resolves it
 *     later. The `CatalogItem` write (Firestore) and the `Product` write
 *     (Postgres) share NO transaction; a Postgres failure leaves a marker, never
 *     breaks the cadastro.
 *   - base unavailable + GTIN absent/invalid → nothing to reconcile (gtin14 null).
 *
 * No exception ever propagates to the caller — that is the load-bearing invariant.
 */
export async function runProductGate(
  rawGtin: string,
  attrs: { name?: string } = {},
): Promise<ProductGateFields> {
  try {
    const result = await resolveGate(rawGtin, attrs)
    return { gtin14: result.kind === 'skipped' ? null : result.gtin14 }
  } catch (err) {
    // Treat ANY failure of the base path as unavailability — the registration is
    // never on the critical path of the base (the load-bearing invariant). We log
    // so a real bug (not a mere outage) is still observable instead of silently
    // becoming a perpetual reconciliation marker.
    logger.error('base path failed; deferring to reconciliation', { scope: 'runProductGate', err })
    // Degrade to best-effort: if the GTIN is valid we still know its canonical key
    // (pure validation, no DB), so we guard it + mark the item for reconciliation.
    // An invalid/absent GTIN has nothing to reconcile.
    const validated = validateGtin(rawGtin)
    if (validated.kind === 'rejected') {
      return { gtin14: null }
    }
    await emitProductEvent({
      event: 'product_contribution_deferred',
      gtin14: validated.gtin14,
      reason: 'unavailable',
    })
    return {
      gtin14: validated.gtin14,
      reconciliationPending: true,
      reconciliationLastAttempt: new Date().toISOString(),
    }
  }
}
