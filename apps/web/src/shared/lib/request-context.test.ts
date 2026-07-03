import { describe, expect, it } from 'vitest'
import { getRequestContext, runWithRequestContext } from './request-context'

describe('request-context', () => {
  it('exposes the context inside the scope and nothing outside', () => {
    expect(getRequestContext()).toBeUndefined()
    const seen = runWithRequestContext({ correlationId: 'c1', orgId: 'o1' }, () =>
      getRequestContext(),
    )
    expect(seen).toEqual({ correlationId: 'c1', orgId: 'o1' })
    // Scope closed — back to undefined.
    expect(getRequestContext()).toBeUndefined()
  })

  it('isolates concurrent async scopes (no bleed between requests)', async () => {
    const results = await Promise.all([
      runWithRequestContext({ correlationId: 'a' }, async () => {
        await Promise.resolve()
        return getRequestContext()?.correlationId
      }),
      runWithRequestContext({ correlationId: 'b' }, async () => {
        await Promise.resolve()
        return getRequestContext()?.correlationId
      }),
    ])
    expect(results).toEqual(['a', 'b'])
  })
})
