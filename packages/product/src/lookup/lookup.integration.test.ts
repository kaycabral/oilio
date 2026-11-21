import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, runMigrations } from '../db/pool'
import { PostgresProductSource } from '../db/repository'
import { product } from '../schema'
import { lookupByGtin } from './lookup'

// Integration: the lookup composes the validator with the REAL Postgres adapter.
// Proves hit/miss against an actual database (the point of the brief — real
// constraints, not a mock). fileParallelism is off so this owns the table.

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'

beforeAll(async () => {
  await runMigrations()
})

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  await getDb().delete(product)
})

describe('lookupByGtin — against real Postgres', () => {
  it('hit: a contributed product is found by its raw EAN-13', async () => {
    const source = new PostgresProductSource()
    await source.upsert({ gtin14: GTIN14, name: 'Leite Ninho 400g', source: 'official' })

    const result = await lookupByGtin(source, EAN13)
    expect(result.kind).toBe('hit')
    if (result.kind !== 'hit') throw new Error('expected hit')
    expect(result.gtin14).toBe(GTIN14)
    expect(result.product.name).toBe('Leite Ninho 400g')
    expect(result.product.source).toBe('official')
  })

  it('miss: a valid but absent GTIN returns a typed miss (no row written)', async () => {
    const source = new PostgresProductSource()

    const result = await lookupByGtin(source, EAN13)
    expect(result).toEqual({ kind: 'miss', gtin14: GTIN14 })

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(0)
  })

  it('invalid: a bad GTIN never touches the base', async () => {
    const source = new PostgresProductSource()

    const result = await lookupByGtin(source, 'not-a-gtin')
    expect(result.kind).toBe('invalid')

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(0)
  })
})
