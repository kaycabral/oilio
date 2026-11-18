import { describe, expect, it } from 'vitest'
import type { ProductSource } from '../port/source'
import type { NewProduct, StoredProduct } from '../schema'
import { resolveProduct } from './resolve'

// Pure unit: the facade folds lookup + auto-contribution. Stub source backed by
// an in-memory map so a contributed row becomes findable (proving the miss→
// contribute→referenceable flow without a DB).

function storedFrom(row: NewProduct): StoredProduct {
  const now = new Date()
  return {
    gtin14: row.gtin14,
    name: row.name,
    description: row.description ?? null,
    brand: row.brand ?? null,
    photoUrl: row.photoUrl ?? null,
    measures: row.measures ?? null,
    ncm: row.ncm ?? null,
    cest: row.cest ?? null,
    utrib: row.utrib ?? null,
    category: row.category ?? null,
    source: row.source,
    createdAt: now,
    updatedAt: now,
  }
}

function mapSource(seed: Record<string, StoredProduct> = {}): ProductSource {
  const rows = new Map<string, StoredProduct>(Object.entries(seed))
  return {
    findByGtin14(gtin14: string): Promise<StoredProduct | null> {
      return Promise.resolve(rows.get(gtin14) ?? null)
    },
    upsert(input: NewProduct): Promise<StoredProduct> {
      const stored = storedFrom(input)
      rows.set(input.gtin14, stored)
      return Promise.resolve(stored)
    },
    searchByName(): Promise<StoredProduct[]> {
      throw new Error('resolve must not search by name')
    },
  }
}

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'

describe('resolveProduct', () => {
  it('referenced: an existing GTIN is referenced, not re-contributed', async () => {
    const existing = storedFrom({ gtin14: GTIN14, name: 'Leite', source: 'official' })
    const result = await resolveProduct(mapSource({ [GTIN14]: existing }), EAN13)

    expect(result.kind).toBe('referenced')
    if (result.kind !== 'referenced') throw new Error('expected referenced')
    expect(result.gtin14).toBe(GTIN14)
    expect(result.product.source).toBe('official')
  })

  it('contributed: a valid + unseen GTIN is auto-contributed', async () => {
    const source = mapSource()
    const result = await resolveProduct(source, EAN13, { name: 'Leite Ninho' })

    expect(result.kind).toBe('contributed')
    if (result.kind !== 'contributed') throw new Error('expected contributed')
    expect(result.gtin14).toBe(GTIN14)
    expect(result.product.source).toBe('org-contributed')
    expect(result.product.name).toBe('Leite Ninho')

    // Idempotent: resolving again now references the contributed row.
    const again = await resolveProduct(source, EAN13, { name: 'Leite Ninho' })
    expect(again.kind).toBe('referenced')
  })

  it('skipped: an invalid GTIN does not touch the base', async () => {
    const result = await resolveProduct(mapSource(), 'garbage')

    expect(result.kind).toBe('skipped')
    if (result.kind !== 'skipped') throw new Error('expected skipped')
    expect(result.reason).toBe('non-numeric')
  })
})
