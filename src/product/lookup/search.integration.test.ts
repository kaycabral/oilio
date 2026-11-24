import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, runMigrations } from '../db/pool'
import { PostgresProductSource } from '../db/repository'
import { product } from '../schema'
import { searchProductsByName } from './search'

const NINHO_400 = '10000000000017'
const NINHO_800 = '10000000000024'
const CAFE = '10000000000031'

async function seed(gtin14: string, name: string): Promise<void> {
  await new PostgresProductSource().upsert({ gtin14, name, source: 'official' })
}

beforeAll(async () => {
  await runMigrations()
})

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  await getDb().delete(product)
})

describe('searchProductsByName — against real Postgres (pg_trgm)', () => {
  it('finds a product by a partial name fragment', async () => {
    const source = new PostgresProductSource()
    await seed(NINHO_400, 'Leite Ninho 400g')

    const results = await searchProductsByName(source, 'ninho')
    expect(results.map((r) => r.product.name)).toContain('Leite Ninho 400g')
    expect(results[0]?.gtin14).toBe(NINHO_400)
  })

  it('tolerates a typo (similarity, not exact match)', async () => {
    const source = new PostgresProductSource()
    await seed(NINHO_400, 'Leite Ninho 400g')

    const typo = await searchProductsByName(source, 'leit ninho')
    expect(typo.map((r) => r.product.name)).toContain('Leite Ninho 400g')
  })

  it('ranks the more-similar product first', async () => {
    const source = new PostgresProductSource()
    await seed(NINHO_400, 'Leite Ninho 400g')
    await seed(CAFE, 'Café Torrado 500g')

    const results = await searchProductsByName(source, 'leite ninho')
    expect(results[0]?.product.name).toBe('Leite Ninho 400g')
  })

  it('respects the top-N cap', async () => {
    const source = new PostgresProductSource()
    await seed(NINHO_400, 'Leite Ninho 400g')
    await seed(NINHO_800, 'Leite Ninho 800g')

    const results = await searchProductsByName(source, 'leite ninho', 1)
    expect(results).toHaveLength(1)
  })

  it('returns an empty array when nothing is similar (zero-match, not an error)', async () => {
    const source = new PostgresProductSource()
    await seed(NINHO_400, 'Leite Ninho 400g')

    const results = await searchProductsByName(source, 'parafuso sextavado')
    expect(results).toEqual([])
  })

  it('an under-length term never reaches the base (returns [])', async () => {
    const source = new PostgresProductSource()
    await seed(NINHO_400, 'Leite Ninho 400g')

    const results = await searchProductsByName(source, 'ni')
    expect(results).toEqual([])
  })
})
