import type { ProductSource } from '../port/source'
import type { NameSearchResult } from './types'

export const MIN_SEARCH_TERM_LENGTH = 3

export const DEFAULT_SEARCH_LIMIT = 10

export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

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
