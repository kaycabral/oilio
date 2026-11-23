/**
 * Typed result of the GTIN validator. Pure data — no I/O.
 *
 * The validator never throws on bad input; it returns a discriminated union so
 * callers branch on `kind` and get a machine-readable `reason` on rejection.
 */

/** Why a GTIN was rejected — machine-readable, stable for logging/metrics. */
export type GtinRejectionReason =
  // no input / blank
  | 'empty'
  // contains non-digit characters
  | 'non-numeric'
  // not 8 / 12 / 13 / 14 digits
  | 'invalid-length'
  // GS1 mod-10 check digit does not match
  | 'check-digit'
  // RCN — company/region-internal, not a global key
  | 'restricted-circulation'
  // coupon / refund-receipt prefix, not a trade item
  | 'coupon-or-receipt'

/** A valid GTIN, normalized to the canonical zero-padded GTIN-14 key. */
export interface GtinValid {
  readonly kind: 'valid'
  /** Canonical key: 14 digits, zero-padded. Check digit preserved (not recomputed). */
  readonly gtin14: string
}

/** A syntactically/structurally invalid or non-canonical GTIN. */
export interface GtinRejected {
  readonly kind: 'rejected'
  readonly reason: GtinRejectionReason
}

export type GtinResult = GtinValid | GtinRejected

/**
 * Fallback identity for items WITHOUT a real GTIN (services, own-manufactured,
 * weighed goods). Resolves an alternative key from `brand` + `mpn` (manufacturer
 * part number) WITHOUT becoming a GTIN or touching the sovereign base — the PRD
 * keeps these self-contained in the `CatalogItem`.
 */
export interface FallbackIdentity {
  readonly kind: 'fallback'
  readonly brand: string
  readonly mpn: string
  /** Stable, normalized composite key for de-dup within a seller's catalog. */
  readonly key: string
}
