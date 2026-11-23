import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const emitProductEvent = vi.fn(() => Promise.resolve())
vi.mock('@/shared/product/product-events', () => ({ emitProductEvent }))

vi.mock('@/shared/org/membership', () => ({
  requireManagerCtx: () => Promise.resolve({ ok: true, ctx: { orgId: 'org-1', uid: 'u-1' } }),
}))

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
    expect(emitProductEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'product_search' }),
    )
  })
})
