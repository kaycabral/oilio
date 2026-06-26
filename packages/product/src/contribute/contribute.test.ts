import { describe, expect, it } from 'vitest'
import type { ProductSource } from '../port/source'
import type { NewProduct, StoredProduct } from '../schema'
import { autoContribute } from './contribute'

// Pure unit: auto-contribution gates on validation and delegates the write to
// the injected source. We stub the source in-memory and CAPTURE the upserted
// row so we can assert the gate, the placeholder name, and provenance. The
// real idempotency (UNIQUE GTIN-14) is proven by the integration suite.

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

function stubSource(): ProductSource & { upserts: NewProduct[] } {
  const upserts: NewProduct[] = []
  return {
    upserts,
    findByGtin14(): Promise<StoredProduct | null> {
      throw new Error('contribute must not read')
    },
    async upsert(input: NewProduct): Promise<StoredProduct> {
      upserts.push(input)
      return storedFrom(input)
    },
    searchByName(): Promise<StoredProduct[]> {
      throw new Error('contribute must not search by name')
    },
  }
}

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'

describe('autoContribute', () => {
  it('contributes a valid GTIN as org-contributed, carrying normalized attrs', async () => {
    const source = stubSource()
    const result = await autoContribute(source, EAN13, {
      name: '  Leite Ninho 400g  ',
      brand: 'Nestlé',
      ncm: '',
    })

    expect(result.kind).toBe('contributed')
    if (result.kind !== 'contributed') throw new Error('expected contributed')
    expect(result.gtin14).toBe(GTIN14)
    expect(source.upserts).toHaveLength(1)
    const row = source.upserts[0]!
    expect(row.gtin14).toBe(GTIN14)
    expect(row.name).toBe('Leite Ninho 400g') // trimmed
    expect(row.brand).toBe('Nestlé')
    expect(row.ncm).toBeNull() // blank → null
    expect(row.source).toBe('org-contributed')
  })

  it('falls back to a placeholder name when none is usable', async () => {
    const source = stubSource()
    const result = await autoContribute(source, EAN13, { name: '   ' })

    expect(result.kind).toBe('contributed')
    expect(source.upserts[0]!.name).toBe('Unnamed product')
  })

  it('defaults all optional attrs to null when omitted', async () => {
    const source = stubSource()
    await autoContribute(source, EAN13)

    const row = source.upserts[0]!
    expect(row.description).toBeNull()
    expect(row.brand).toBeNull()
    expect(row.photoUrl).toBeNull()
    expect(row.category).toBeNull()
  })

  it('GATE: a rejected GTIN never writes (AC-04)', async () => {
    const source = stubSource()
    const result = await autoContribute(source, '123')

    expect(result).toEqual({ kind: 'rejected', reason: 'invalid-length' })
    expect(source.upserts).toEqual([])
  })

  it('GATE: an empty GTIN is rejected, no write', async () => {
    const source = stubSource()
    const result = await autoContribute(source, '')

    expect(result).toEqual({ kind: 'rejected', reason: 'empty' })
    expect(source.upserts).toEqual([])
  })
})
