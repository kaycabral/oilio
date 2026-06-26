import { validateGtin } from '../gtin'
import type { ProductSource } from '../port/source'
import type { LookupResult } from './types'

/**
 * Look up a product in the sovereign base by a raw (un-normalized) GTIN.
 *
 * Pipeline (AC-01):
 *   1. validate + normalize the GTIN to its canonical GTIN-14 (pure, A1's
 *      validator). A rejected GTIN returns `invalid` WITHOUT touching the base.
 *   2. query the source by the normalized key.
 *   3. row present → `hit` (intrinsics + source); absent → `miss` (typed, not an
 *      error) — the signal auto-contribution acts on.
 *
 * The source is the A1 `ProductSource` port — Postgres in production, swappable
 * for a stub in tests. No I/O happens for an invalid GTIN.
 */
export async function lookupByGtin(source: ProductSource, rawGtin: string): Promise<LookupResult> {
  const validated = validateGtin(rawGtin)
  if (validated.kind === 'rejected') {
    return { kind: 'invalid', reason: validated.reason }
  }

  const { gtin14 } = validated
  const product = await source.findByGtin14(gtin14)
  if (product === null) {
    return { kind: 'miss', gtin14 }
  }
  return { kind: 'hit', gtin14, product }
}
