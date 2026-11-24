export {
  classifyPrefix,
  computeCheckDigit,
  hasValidCheckDigit,
  resolveFallback,
  validateGtin,
  type FallbackIdentity,
  type GtinRejected,
  type GtinRejectionReason,
  type GtinResult,
  type GtinValid,
  type PrefixClass,
} from './gtin'

export {
  product,
  productSource,
  type NewProduct,
  type ProductMeasures,
  type StoredProduct,
} from './schema'

export { PostgresProductSource, closeDb, getDb, initProductDb, runMigrations } from './db'
export type { ProductSource } from './port/source'

export { lookupByGtin } from './lookup'
export type { LookupResult } from './lookup'

export {
  DEFAULT_SEARCH_LIMIT,
  MIN_SEARCH_TERM_LENGTH,
  normalizeSearchTerm,
  searchProductsByName,
} from './lookup'
export type { NameSearchResult } from './lookup'

export { autoContribute } from './contribute'
export type { ContributableAttributes, ContributionResult } from './contribute'

export { resolveProduct } from './engine'
export type { ResolveOutcome } from './engine'
