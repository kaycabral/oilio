// Pure GTIN validator (no I/O) — the only part importable without a database.
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

// Sovereign Product table (schema + types).
export {
  product,
  productSource,
  type NewProduct,
  type ProductMeasures,
  type StoredProduct,
} from './schema'

// Data-source Port + Postgres adapter + connection.
export { PostgresProductSource, closeDb, getDb, runMigrations } from './db'
export type { ProductSource } from './port/source'

// Domain engine: GTIN lookup (hit/miss/invalid) over a `ProductSource`.
export { lookupByGtin } from './lookup'
export type { LookupResult } from './lookup'

// Name search: typo-tolerant autocomplete over a `ProductSource` (feature D).
export {
  DEFAULT_SEARCH_LIMIT,
  MIN_SEARCH_TERM_LENGTH,
  normalizeSearchTerm,
  searchProductsByName,
} from './lookup'
export type { NameSearchResult } from './lookup'

// Auto-contribution: idempotent `org-contributed` upsert, gated by validation.
export { autoContribute } from './contribute'
export type { ContributableAttributes, ContributionResult } from './contribute'

// Registration-time facade: lookup → reference (hit) / auto-contribute (miss) /
// skip (invalid). The single entry the consumer calls in the catalog gate.
export { resolveProduct } from './engine'
export type { ResolveOutcome } from './engine'
