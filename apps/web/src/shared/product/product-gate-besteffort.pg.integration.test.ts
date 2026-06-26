import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Best-effort invariant (brief 0050, AC-06/AC-07): the sovereign base is NEVER
// on the critical path of registration. This suite points the gate at a DEAD
// Postgres (a closed port) and proves the gate degrades instead of throwing —
// it stores the GTIN + a reconciliation marker and emits the deferred event.
//
// It runs in the Postgres-integration layer (real `pg` driver, real connection
// attempt — to nowhere), NOT the emulator layer. Telemetry is stubbed (it would
// otherwise need Firestore); we assert the deferred event was emitted.

const emitProductEvent = vi.fn(() => Promise.resolve())
vi.mock('./product-events', () => ({ emitProductEvent }))

const EAN13 = '7891000100103'
const GTIN14 = '07891000100103'

// Force the lazy pool to a closed port BEFORE the gate module builds its source.
// 127.0.0.1:1 is reliably refused; the pg pool errors on first query.
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

    // Cadastro completes: the GTIN is guarded, the item is flagged for reconcile.
    expect(fields.gtin14).toBe(GTIN14)
    expect(fields.reconciliationPending).toBe(true)
    expect(typeof fields.reconciliationLastAttempt).toBe('string')

    // The deferred event was emitted (reason: unavailable).
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
