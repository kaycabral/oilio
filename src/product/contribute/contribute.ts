import { validateGtin } from '../gtin'
import type { ProductSource } from '../port/source'
import type { NewProduct, StoredProduct } from '../schema'
import type { ContributableAttributes, ContributionResult } from './types'

const PLACEHOLDER_NAME = 'Unnamed product'

function optional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

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
