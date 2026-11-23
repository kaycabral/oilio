import type { GtinRejectionReason } from '../gtin'
import type { StoredProduct } from '../schema'

/**
 * Typed result of a sovereign-base lookup by GTIN. Pure data — a discriminated
 * union, never an exception (AC-01: miss is a typed signal, not an error).
 *
 *   - hit     — the GTIN is valid AND a `Product` exists. Carries the intrinsic
 *               attributes (the stored row) plus its provenance `source`.
 *   - miss    — the GTIN is valid but NO `Product` exists yet. This is the signal
 *               auto-contribution acts on (a valid + unseen GTIN).
 *   - invalid — the GTIN was rejected by the validator BEFORE any DB query. The
 *               base is never consulted for a non-canonical key (AC-01: an
 *               invalid/absent GTIN never reaches the base).
 *
 * `gtin14` is present on hit/miss (the normalized canonical key) so callers can
 * stash it on the consumer item and reconcile later, even on a miss.
 */
export type LookupResult =
  | { readonly kind: 'hit'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'miss'; readonly gtin14: string }
  | { readonly kind: 'invalid'; readonly reason: GtinRejectionReason }

/**
 * One suggestion from a name search (brief 0055, feature D). Carries the stored
 * row (the intrinsics the combobox shows + fills on selection) plus its canonical
 * `gtin14` — the key the consumer stamps on its item to reference the product,
 * exactly like a GTIN hit. A name search returns an ordered list of these (top-N
 * by similarity desc); an empty list is a zero-match, not an error.
 */
export interface NameSearchResult {
  readonly gtin14: string
  readonly product: StoredProduct
}
