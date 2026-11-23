import type { ProductSource } from '../port/source'
import type { NameSearchResult } from './types'

/**
 * Minimum length (in characters, after normalization) a search term must reach
 * before the base is consulted (AC-05). Below this, `pg_trgm` similarity is mostly
 * noise and the query is pure load — so an under-length term short-circuits to an
 * empty result WITHOUT touching the source. The client mirrors this gate (the
 * combobox only fires at ≥3 chars); enforcing it here too keeps the invariant
 * server-side regardless of caller.
 */
export const MIN_SEARCH_TERM_LENGTH = 3

/**
 * Default cap for `searchProductsByName` — the top-N suggestions a combobox shows
 * (brief 0055: top-10 by similarity desc).
 */
export const DEFAULT_SEARCH_LIMIT = 10

/**
 * Normalize a raw search term the SAME way on client and server (AC-05): collapse
 * internal whitespace, trim the ends, and casefold. The normalized term is what
 * gates the min-length check and what the source's similarity query receives — so
 * a term that is under-length only because of surrounding spaces is correctly
 * rejected, and "Leite  Ninho" / "leite ninho" hit the base identically.
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Search the sovereign base by product NAME for the autocomplete combobox (brief
 * 0055, feature D).
 *
 * Pipeline (mirrors `lookupByGtin`'s shape — a pure gate, then one source call):
 *   1. normalize the term (trim/collapse/casefold) consistently with the client.
 *   2. an under-length term (< MIN_SEARCH_TERM_LENGTH) returns `[]` WITHOUT a
 *      query (AC-05) — no noise, no load.
 *   3. otherwise query the source by trigram similarity, capped at `limit`,
 *      ranked desc. A zero-match is an empty array, never an error.
 *
 * Read-only: search never writes to the base (unlike the GTIN gate, which
 * auto-contributes on a miss). The consumer wraps THIS in best-effort (AC-04):
 * a DB-down throw degrades to "no suggestions", never a blocked registration.
 */
export async function searchProductsByName(
  source: ProductSource,
  rawQuery: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<NameSearchResult[]> {
  const query = normalizeSearchTerm(rawQuery)
  if (query.length < MIN_SEARCH_TERM_LENGTH) {
    return []
  }

  const rows = await source.searchByName(query, limit)
  return rows.map((product) => ({ gtin14: product.gtin14, product }))
}
