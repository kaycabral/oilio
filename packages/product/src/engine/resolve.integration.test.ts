import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, runMigrations } from '../db/pool'
import { PostgresProductSource } from '../db/repository'
import { product } from '../schema'
import { resolveProduct } from './resolve'

// Integration: the auto-contribution flow against REAL Postgres — idempotency
// comes from the native UNIQUE GTIN-14 (A1), not application code. Proves AC-03
// (idempotent), AC-04 (invalid never enters) end-to-end.

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'
const OTHER_EAN13 = '7894900011517'

beforeAll(async () => {
  await runMigrations()
})

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  await getDb().delete(product)
})

describe('resolveProduct — auto-contribution against real Postgres', () => {
  it('contributes a valid unseen GTIN as org-contributed', async () => {
    const source = new PostgresProductSource()
    const result = await resolveProduct(source, EAN13, {
      name: 'Leite Ninho 400g',
      brand: 'Nestlé',
    })

    expect(result.kind).toBe('contributed')
    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.gtin14).toBe(GTIN14)
    expect(rows[0]!.source).toBe('org-contributed')
    expect(rows[0]!.brand).toBe('Nestlé')
  })

  it('IDEMPOTENT: re-resolving the same GTIN does not duplicate (AC-03)', async () => {
    const source = new PostgresProductSource()
    await resolveProduct(source, EAN13, { name: 'Leite Ninho 400g' })
    const second = await resolveProduct(source, EAN13, { name: 'Leite Ninho 400g' })

    // Second resolve finds the row → references it, never a duplicate insert.
    expect(second.kind).toBe('referenced')
    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
  })

  it('GATE: an invalid GTIN never enters the base (AC-04)', async () => {
    const source = new PostgresProductSource()
    const result = await resolveProduct(source, '12345', { name: 'Bad' })

    expect(result.kind).toBe('skipped')
    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(0)
  })

  it('references a pre-existing official product instead of contributing', async () => {
    const source = new PostgresProductSource()
    await source.upsert({ gtin14: GTIN14, name: 'Official Leite', source: 'official' })

    const result = await resolveProduct(source, EAN13, { name: 'ignored' })
    expect(result.kind).toBe('referenced')
    if (result.kind !== 'referenced') throw new Error('expected referenced')
    // not downgraded to org-contributed
    expect(result.product.source).toBe('official')
  })

  it('contributes distinct GTINs as separate rows', async () => {
    const source = new PostgresProductSource()
    await resolveProduct(source, EAN13, { name: 'A' })
    await resolveProduct(source, OTHER_EAN13, { name: 'B' })

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(2)
  })
})
