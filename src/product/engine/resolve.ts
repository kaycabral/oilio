import type { ContributableAttributes } from '../contribute'
import { contributeNormalized } from '../contribute'
import type { GtinRejectionReason } from '../gtin'
import { validateGtin } from '../gtin'
import type { ProductSource } from '../port/source'
import type { StoredProduct } from '../schema'

export type ResolveOutcome =
  | { readonly kind: 'referenced'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'contributed'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'skipped'; readonly reason: GtinRejectionReason }

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

  const product = await contributeNormalized(source, gtin14, attrs)
  return { kind: 'contributed', gtin14, product }
}
