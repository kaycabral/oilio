import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const emitProductEvent = vi.fn(() => Promise.resolve())
vi.mock('./product-events', () => ({ emitProductEvent }))

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:1/produtos'
  vi.resetModules()
})
afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL
})

describe('runProductGate — base UNAVAILABLE (best-effort invariant)', () => {
  it('does NOT throw; guards the GTIN + sets the reconciliation marker', async () => {
    const { runProductGate } = await import('./product-gate')
    const fields = await runProductGate(EAN13)

    expect(fields.gtin14).toBe(GTIN14)
    expect(fields.reconciliationPending).toBe(true)
    expect(typeof fields.reconciliationLastAttempt).toBe('string')

    expect(emitProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'product_contribution_deferred',
        gtin14: GTIN14,
        reason: 'unavailable',
      }),
    )
  })

  it('an invalid GTIN with the base down has nothing to reconcile', async () => {
    const { runProductGate } = await import('./product-gate')
    const fields = await runProductGate('not-a-gtin')

    expect(fields.gtin14).toBeNull()
    expect(fields.reconciliationPending).toBeUndefined()
  })
})
