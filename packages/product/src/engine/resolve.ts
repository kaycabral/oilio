import type { ContributableAttributes } from '../contribute'
import { contributeNormalized } from '../contribute'
import type { GtinRejectionReason } from '../gtin'
import { validateGtin } from '../gtin'
import type { ProductSource } from '../port/source'
import type { StoredProduct } from '../schema'

/**
 * Outcome of resolving a product at registration time — the single entry the
 * consumer (oilio) calls in the catalog gate. It folds lookup + auto-contribution
 * into one typed result so the consumer branches once:
 *
 *   - referenced   — the GTIN was already known (lookup hit). Reference it.
 *   - contributed  — the GTIN was valid + unseen; an `org-contributed` row was
 *                    created (lookup miss → auto-contribution).
 *   - skipped      — the GTIN failed validation; the base was not touched. The
 *                    item stays self-contained in the consumer (no reference).
 *
 * On `referenced`/`contributed` the consumer stores `gtin14` on its item to link
 * by reference (invisible in UX). `skipped` carries the rejection `reason` for
 * logging only.
 */
export type ResolveOutcome =
  | { readonly kind: 'referenced'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'contributed'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'skipped'; readonly reason: GtinRejectionReason }

/**
 * Resolve a product for registration: validate the GTIN once, look it up, and on
 * a (valid) miss auto-contribute it. This is the gate that runs at catalog
 * registration (AC-05), NOT at sale. It throws only on a real infrastructure
 * failure (DB down) — the consumer wraps THAT in best-effort (AC-06); a bad GTIN
 * is a typed `skipped`, never a throw.
 *
 * Validation happens once here (the gate), so the lower-level `contributeNormalized`
 * takes the already-normalized key — there is no second validation pass.
 */
export async function resolveProduct(
  source: ProductSource,
  rawGtin: string,
  attrs: ContributableAttributes = {},
): Promise<ResolveOutcome> {
  const validated = validateGtin(rawGtin)
  if (validated.kind === 'rejected') {
    return { kind: 'skipped', reason: validated.reason }
  }

  const { gtin14 } = validated
  const existing = await source.findByGtin14(gtin14)
  if (existing !== null) {
    return { kind: 'referenced', gtin14, product: existing }
  }

  // miss → valid + unseen → auto-contribute (idempotent by GTIN-14).
  const product = await contributeNormalized(source, gtin14, attrs)
  return { kind: 'contributed', gtin14, product }
}
