import { describe, expect, it } from 'vitest'
import type { ProductSource } from '../port/source'
import type { NewProduct, StoredProduct } from '../schema'
import { lookupByGtin } from './lookup'

// Pure unit test: the lookup composes the validator + a ProductSource. We stub
// the source in-memory (no DB) — the real Postgres path is covered by the
// integration suite. The stub also COUNTS queries so we can prove an invalid
// GTIN never reaches the base (AC-01).

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

function stubSource(rows: Record<string, StoredProduct>): ProductSource & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    async findByGtin14(gtin14: string): Promise<StoredProduct | null> {
      queries.push(gtin14)
      return rows[gtin14] ?? null
    },
    upsert(_input: NewProduct): Promise<StoredProduct> {
      throw new Error('lookup must not write')
    },
    searchByName(): Promise<StoredProduct[]> {
      throw new Error('lookup by GTIN must not search by name')
    },
  }
}

// Real GTINs (valid GS1 check digit). 13-digit EAN normalizes to 14 (zero-pad).
const EAN13 = '7891000100103' // valid check digit
const GTIN14_OF_EAN13 = '07891000100103'

describe('lookupByGtin', () => {
  it('hit: valid GTIN with a row returns the intrinsics + source', async () => {
    const source = stubSource({ [GTIN14_OF_EAN13]: storedFrom(GTIN14_OF_EAN13, 'Leite') })
    const result = await lookupByGtin(source, EAN13)

    expect(result.kind).toBe('hit')
    if (result.kind !== 'hit') throw new Error('expected hit')
    expect(result.gtin14).toBe(GTIN14_OF_EAN13)
    expect(result.product.name).toBe('Leite')
    expect(result.product.source).toBe('official')
    expect(source.queries).toEqual([GTIN14_OF_EAN13])
  })

  it('miss: valid GTIN with no row returns a typed miss carrying the gtin14', async () => {
    const source = stubSource({})
    const result = await lookupByGtin(source, EAN13)

    expect(result.kind).toBe('miss')
    if (result.kind !== 'miss') throw new Error('expected miss')
    expect(result.gtin14).toBe(GTIN14_OF_EAN13)
    // The normalized key is queried so callers can stash + reconcile it.
    expect(source.queries).toEqual([GTIN14_OF_EAN13])
  })

  it('invalid: a rejected GTIN never queries the base', async () => {
    const source = stubSource({})
    const result = await lookupByGtin(source, '123') // wrong length

    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') throw new Error('expected invalid')
    expect(result.reason).toBe('invalid-length')
    expect(source.queries).toEqual([]) // base untouched
  })

  it('invalid: an empty GTIN is rejected with reason "empty", no query', async () => {
    const source = stubSource({})
    const result = await lookupByGtin(source, '   ')

    expect(result).toEqual({ kind: 'invalid', reason: 'empty' })
    expect(source.queries).toEqual([])
  })

  it('normalizes separators before querying (scanner hyphens/spaces)', async () => {
    const source = stubSource({ [GTIN14_OF_EAN13]: storedFrom(GTIN14_OF_EAN13, 'Leite') })
    const result = await lookupByGtin(source, ' 789-1000-100103 ')

    expect(result.kind).toBe('hit')
    expect(source.queries).toEqual([GTIN14_OF_EAN13])
  })
})
