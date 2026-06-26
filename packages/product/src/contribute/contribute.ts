import { validateGtin } from '../gtin'
import type { ProductSource } from '../port/source'
import type { NewProduct, StoredProduct } from '../schema'
import type { ContributableAttributes, ContributionResult } from './types'

/** Placeholder name for a contribution with no usable name (the table requires a
 * non-blank `name`; an org-contributed row is allowed to be minimal). English by
 * design: this is intrinsic data persisted to the cross-org base, not a localized
 * label — the consumer renders its own copy. */
const PLACEHOLDER_NAME = 'Unnamed product'

/** Normalize an optional intrinsic string: trim, treat blank as absent (null). */
function optional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Upsert an `org-contributed` row for an ALREADY-VALIDATED GTIN-14. Internal: the
 * caller has validated the key (so there is no rejection path here). Idempotent
 * by the GTIN-14 UNIQUE key from A1 (AC-03): re-contributing the same GTIN updates
 * intrinsics instead of duplicating. Born minimal (PRD: org-contributed rows may
 * be rala) — only `name` is required, so a missing name falls back to a placeholder.
 */
export async function contributeNormalized(
  source: ProductSource,
  gtin14: string,
  attrs: ContributableAttributes = {},
): Promise<StoredProduct> {
  const row: NewProduct = {
    gtin14,
    name: optional(attrs.name) ?? PLACEHOLDER_NAME,
    description: optional(attrs.description),
    brand: optional(attrs.brand),
    photoUrl: optional(attrs.photoUrl),
    ncm: optional(attrs.ncm),
    cest: optional(attrs.cest),
    utrib: optional(attrs.utrib),
    category: optional(attrs.category),
    source: 'org-contributed',
  }
  return source.upsert(row)
}

/**
 * Auto-contribute a product to the sovereign base from a raw GTIN + whatever
 * intrinsic attributes the consumer could normalize.
 *
 * The validation gate is load-bearing (AC-04): a GTIN that fails validation
 * returns `rejected` and NEVER writes — invalid/garbage GTINs do not enter the
 * base. A valid GTIN upserts via `contributeNormalized`.
 */
export async function autoContribute(
  source: ProductSource,
  rawGtin: string,
  attrs: ContributableAttributes = {},
): Promise<ContributionResult> {
  const validated = validateGtin(rawGtin)
  if (validated.kind === 'rejected') {
    return { kind: 'rejected', reason: validated.reason }
  }

  const product = await contributeNormalized(source, validated.gtin14, attrs)
  return { kind: 'contributed', gtin14: validated.gtin14, product }
}
