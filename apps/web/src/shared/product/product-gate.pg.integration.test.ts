import { closeDb, getDb, PostgresProductSource, product, runMigrations } from '@cbrl/product'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Telemetry is best-effort and writes Firestore; this suite proves the Postgres
// gate behavior, so we stub the event sink (no emulator needed here).
vi.mock('./product-events', () => ({
  emitProductEvent: () => Promise.resolve(),
}))

import { resolveGate, runProductGate } from './product-gate'

// Integration: the oilio registration gate against REAL Postgres (the sovereign
// base from A1). Proves the gate resolves/contributes correctly and idempotently
// — the engine half of AC-03/AC-04/AC-05. Brought up by the product Postgres
// runner (scripts/oilio-gate-it.mjs) with DATABASE_URL injected; migrations are
// applied here. The best-effort invariant (Postgres DOWN) is a separate suite.

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

describe('runProductGate — against real Postgres', () => {
  it('contributes a valid unseen GTIN with the product name (not a placeholder)', async () => {
    const fields = await runProductGate(EAN13, { name: 'Leite Ninho 400g' })
    expect(fields.gtin14).toBe(GTIN14)

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source).toBe('org-contributed')
    // The consumer's product name reaches the base — not the 'Unnamed product'
    // placeholder (regression: the gate used to discard the name).
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
    // Existing provenance preserved — a reference never downgrades to org-contributed.
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
