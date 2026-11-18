import { closeDb, getDb, PostgresProductSource, product } from '@oilio/product'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./product-events', () => ({
  emitProductEvent: () => Promise.resolve(),
}))

import { resolveGate, runProductGate } from './product-gate'

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  await getDb().delete(product)
})

describe('runProductGate — against real Postgres', () => {
  it('contributes a valid unseen GTIN with the product name (not a placeholder)', async () => {
    const fields = await runProductGate(EAN13, { name: 'Leite Ninho 400g' })
    expect(fields.gtin14).toBe(GTIN14)

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source).toBe('org-contributed')
    expect(rows[0]!.name).toBe('Leite Ninho 400g')
  })

  it('falls back to the placeholder name when the consumer has none', async () => {
    await runProductGate(EAN13)
    const rows = await getDb().select().from(product)
    expect(rows[0]!.name).toBe('Unnamed product')
  })

  it('references an existing product without duplicating (idempotent)', async () => {
    await new PostgresProductSource().upsert({
      gtin14: GTIN14,
      name: 'Official',
      source: 'official',
    })
    const fields = await runProductGate(EAN13)
    expect(fields.gtin14).toBe(GTIN14)

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source).toBe('official')
  })

  it('skips an invalid GTIN: null reference, base untouched', async () => {
    const fields = await runProductGate('not-a-gtin')
    expect(fields.gtin14).toBeNull()

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(0)
  })

  it('skips an empty GTIN (item with no code)', async () => {
    const fields = await runProductGate('')
    expect(fields.gtin14).toBeNull()
    expect(await getDb().select().from(product)).toHaveLength(0)
  })
})

describe('resolveGate — outcome kinds', () => {
  it('returns referenced/contributed/skipped per the GTIN', async () => {
    expect((await resolveGate('garbage')).kind).toBe('skipped')
    expect((await resolveGate(EAN13)).kind).toBe('contributed')
    expect((await resolveGate(EAN13)).kind).toBe('referenced')
  })
})
