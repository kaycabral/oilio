import type { GtinRejectionReason } from '../gtin'
import type { StoredProduct } from '../schema'

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

export type ContributionResult =
  | { readonly kind: 'contributed'; readonly gtin14: string; readonly product: StoredProduct }
  | { readonly kind: 'rejected'; readonly reason: GtinRejectionReason }
