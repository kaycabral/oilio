import { describe, expect, it } from 'vitest'
import type { ProductSource } from '../port/source'
import type { NewProduct, StoredProduct } from '../schema'
import {
  DEFAULT_SEARCH_LIMIT,
  MIN_SEARCH_TERM_LENGTH,
  normalizeSearchTerm,
  searchProductsByName,
} from './search'

// Pure unit test: the search composes a normalization/min-length gate with a
// ProductSource. We stub the source in-memory (no DB) and COUNT its calls so we
// can prove an under-length term never reaches the base (AC-05). The real
// pg_trgm similarity path is covered by the integration suite.

function storedFrom(gtin14: string, name: string): StoredProduct {
  const now = new Date()
  return {
    gtin14,
    name,
    description: null,
    brand: null,
    photoUrl: null,
    measures: null,
    ncm: null,
    cest: null,
    utrib: null,
    category: null,
    source: 'official',
    createdAt: now,
    updatedAt: now,
  }
}

function stubSource(
  rows: StoredProduct[],
): ProductSource & { calls: Array<{ query: string; limit: number }> } {
  const calls: Array<{ query: string; limit: number }> = []
  return {
    calls,
    findByGtin14(_gtin14: string): Promise<StoredProduct | null> {
      throw new Error('search must not look up by GTIN')
    },
    upsert(_input: NewProduct): Promise<StoredProduct> {
      throw new Error('search must not write')
    },
    async searchByName(query: string, limit: number): Promise<StoredProduct[]> {
      calls.push({ query, limit })
      return rows.slice(0, limit)
    },
  }
}

describe('normalizeSearchTerm', () => {
  it('trims, collapses internal whitespace and casefolds', () => {
    expect(normalizeSearchTerm('  Leite   Ninho  ')).toBe('leite ninho')
  })

  it('maps a whitespace-only term to empty (so the min-length gate rejects it)', () => {
    expect(normalizeSearchTerm('   ')).toBe('')
  })

  it('is idempotent on an already-normalized term', () => {
    expect(normalizeSearchTerm('leite ninho')).toBe('leite ninho')
  })
})

describe('searchProductsByName', () => {
  it('queries the source and maps rows to results carrying the gtin14', async () => {
    const source = stubSource([storedFrom('07891000100103', 'Leite Ninho 400g')])
    const results = await searchProductsByName(source, 'ninho')

    expect(results).toEqual([
      {
        gtin14: '07891000100103',
        product: expect.objectContaining({ name: 'Leite Ninho 400g' }),
      },
    ])
    // The normalized term + default cap reach the source.
    expect(source.calls).toEqual([{ query: 'ninho', limit: DEFAULT_SEARCH_LIMIT }])
  })

  it('normalizes the term before querying (case + surrounding/inner whitespace)', async () => {
    const source = stubSource([storedFrom('07891000100103', 'Leite Ninho 400g')])
    await searchProductsByName(source, '  LEITE   Ninho ')

    expect(source.calls).toEqual([{ query: 'leite ninho', limit: DEFAULT_SEARCH_LIMIT }])
  })

  it('an under-length term returns [] WITHOUT querying the base (AC-05)', async () => {
    const source = stubSource([storedFrom('07891000100103', 'Leite Ninho 400g')])
    const results = await searchProductsByName(source, 'ni')

    expect(results).toEqual([])
    expect(source.calls).toEqual([]) // base untouched
  })

  it('a term under-length only because of whitespace is rejected without a query', async () => {
    const source = stubSource([storedFrom('07891000100103', 'Leite Ninho 400g')])
    const results = await searchProductsByName(source, ` ${'ab'} `)

    expect(results).toEqual([])
    expect(source.calls).toEqual([])
  })

  it('a term at exactly the minimum length is queried', async () => {
    const source = stubSource([])
    const atMin = 'x'.repeat(MIN_SEARCH_TERM_LENGTH)
    await searchProductsByName(source, atMin)

    expect(source.calls).toEqual([{ query: atMin, limit: DEFAULT_SEARCH_LIMIT }])
  })

  it('a zero-match returns an empty array, not an error', async () => {
    const source = stubSource([])
    const results = await searchProductsByName(source, 'inexistente')

    expect(results).toEqual([])
    expect(source.calls).toHaveLength(1) // it DID query — empty is a real miss
  })

  it('honors an explicit limit (passed through to the source)', async () => {
    const source = stubSource([
      storedFrom('07891000100103', 'Leite Ninho 400g'),
      storedFrom('07891000100110', 'Leite Ninho 800g'),
    ])
    const results = await searchProductsByName(source, 'ninho', 1)

    expect(results).toHaveLength(1)
    expect(source.calls).toEqual([{ query: 'ninho', limit: 1 }])
  })
})
