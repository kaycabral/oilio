import type { GtinRejectionReason } from '../gtin'
import type { StoredProduct } from '../schema'

export type LookupResult =
  | { readonly kind: 'hit'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'miss'; readonly gtin14: string }
  | { readonly kind: 'invalid'; readonly reason: GtinRejectionReason }

export interface NameSearchResult {
  readonly gtin14: string
  readonly product: StoredProduct
}
