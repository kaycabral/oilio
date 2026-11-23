import { validateGtin } from '../gtin'
import type { ProductSource } from '../port/source'
import type { LookupResult } from './types'

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
