import type { NewProduct, StoredProduct } from '../schema'

/**
 * Port for a product DATA SOURCE (hexagonal / ports-and-adapters).
 *
 * The sovereign base is designed to read from pluggable sources — the Postgres
 * base itself, and later external sources (GS1 / Icecat / Open Food Facts). A1
 * only DESIGNS this interface (AC-10) and ships the Postgres-backed adapter; the
 * external adapters and the lookup/auto-contribution flow are A2 (brief 0050).
 *
 * `findByGtin14` takes the already-normalized canonical key (callers validate via
 * `validateGtin` first). `upsert` is idempotent on the GTIN-14 UNIQUE constraint —
 * the property A2's auto-contribution relies on.
 */
export interface ProductSource {
  /** Fetch the product for a canonical GTIN-14 key, or null if absent. */
  findByGtin14(gtin14: string): Promise<StoredProduct | null>

  /** Insert or update by GTIN-14. Idempotent (UNIQUE key). Returns the stored row. */
  upsert(input: NewProduct): Promise<StoredProduct>

  /**
   * Search the base by product NAME, ranked by trigram similarity (`pg_trgm`)
   * descending — typo-tolerant autocomplete (brief 0055, feature D). The query is
   * the already-normalized term (callers normalize via `normalizeSearchTerm`); the
   * caller is also responsible for the min-length gate (an under-length term must
   * not reach the source). `limit` caps the result set (top-N). No `orgId` — the
   * base is cross-org. Returns the matched rows (possibly empty), never throws for
   * a zero-match (a miss is an empty array, not an error).
   */
  searchByName(query: string, limit: number): Promise<StoredProduct[]>
}
