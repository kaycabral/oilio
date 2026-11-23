import type { GtinRejectionReason } from '../gtin'
import type { StoredProduct } from '../schema'

/**
 * The intrinsic attributes a consumer can offer when auto-contributing an unseen
 * product. Everything but the (implicit) GTIN-14 key is optional — auto-contributed
 * rows are born minimal (the PRD allows them to be sparse); only `name` is required
 * by the table, so the engine falls back to a placeholder when the consumer has none.
 * NO `orgId` — the base is cross-org (the `Product` table forbids it).
 */
export interface ContributableAttributes {
  readonly name?: string
  readonly description?: string | null
  readonly brand?: string | null
  readonly photoUrl?: string | null
  readonly ncm?: string | null
  readonly cest?: string | null
  readonly utrib?: string | null
  readonly category?: string | null
}

/**
 * Typed result of auto-contribution. Like the lookup, never an exception for a
 * bad GTIN: a rejected GTIN returns `rejected` (the validation gate — AC-04, an
 * invalid GTIN never enters the base) without any write.
 *
 *   - contributed — a valid GTIN; the `org-contributed` row was upserted
 *                   (idempotent by GTIN-14 — repeating does not duplicate, AC-03).
 *   - rejected    — the GTIN failed validation; nothing was written.
 */
export type ContributionResult =
  | { readonly kind: 'contributed'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'rejected'; readonly reason: GtinRejectionReason }
