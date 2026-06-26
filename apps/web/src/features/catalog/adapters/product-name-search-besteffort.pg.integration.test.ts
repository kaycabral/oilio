import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Best-effort invariant (brief 0055, AC-04): the sovereign base is NEVER on the
// critical path. This suite points the name search at a DEAD Postgres (a closed
// port) and proves the action degrades to an empty result instead of throwing —
// so the combobox becomes an ordinary name input and the cadastro never blocks.
//
// It runs in the Postgres-integration layer (real `pg` driver, real connection
// attempt — to nowhere), NOT the emulator layer. Auth + telemetry are stubbed
// (they would otherwise need Firestore); we assert the action returns [].

const emitProductEvent = vi.fn(() => Promise.resolve())
vi.mock('@/shared/product/product-events', () => ({ emitProductEvent }))

// A manager passes the authz floor — the best-effort path under test is the base
// read, not the gate. requireManagerCtx returns a discriminated result.
vi.mock('@/shared/org/membership', () => ({
  requireManagerCtx: () => Promise.resolve({ ok: true, ctx: { orgId: 'org-1', uid: 'u-1' } }),
}))

// Force the lazy pool to a closed port BEFORE the action module builds its
// source. 127.0.0.1:1 is reliably refused; the pg pool errors on first query.
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:1/produtos'
  vi.resetModules()
})
afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL
})

describe('searchProductsByNameForForm — base UNAVAILABLE (best-effort, AC-04)', () => {
  it('does NOT throw; degrades to an empty suggestion list', async () => {
    const { searchProductsByNameForForm } = await import('./product-name-search.action')
    const results = await searchProductsByNameForForm('leite ninho')
    expect(results).toEqual([])
  })

  it('an under-length term short-circuits to [] without touching the base', async () => {
    const { searchProductsByNameForForm } = await import('./product-name-search.action')
    const results = await searchProductsByNameForForm('ni')
    expect(results).toEqual([])
    // Below the gate, no observability event is emitted either (no real search).
    expect(emitProductEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'product_search' }),
    )
  })
})
