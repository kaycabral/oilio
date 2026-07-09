import { describe, expect, it } from 'vitest'
import {
  correlationIdFromHeaders,
  getRequestContext,
  runWithRequestContext,
  withActionContext,
  withRequestContext,
} from './request-context'

describe('request-context', () => {
  it('exposes the context inside the scope and nothing outside', () => {
    expect(getRequestContext()).toBeUndefined()
    const seen = runWithRequestContext({ correlationId: 'c1', orgId: 'o1' }, () =>
      getRequestContext(),
    )
    expect(seen).toEqual({ correlationId: 'c1', orgId: 'o1' })
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

describe('correlationIdFromHeaders', () => {
  it('reuses the Cloud Run trace id (part before the slash)', () => {
    const h = new Headers({ 'x-cloud-trace-context': 'abc123def456/9876;o=1' })
    expect(correlationIdFromHeaders(h)).toBe('abc123def456')
  })

  it('falls back to the W3C traceparent trace id (2nd field)', () => {
    const h = new Headers({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    })
    expect(correlationIdFromHeaders(h)).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('falls back to x-request-id', () => {
    expect(correlationIdFromHeaders(new Headers({ 'x-request-id': 'req-42' }))).toBe('req-42')
  })

  it('mints a fresh id when no correlation header is present', () => {
    const a = correlationIdFromHeaders(new Headers())
    const b = correlationIdFromHeaders(new Headers())
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('prefers cloud-trace over traceparent over x-request-id', () => {
    const h = new Headers({
      'x-cloud-trace-context': 'cloud/1',
      traceparent: '00-tp-sp-01',
      'x-request-id': 'rid',
    })
    expect(correlationIdFromHeaders(h)).toBe('cloud')
  })
})

describe('withRequestContext (route handlers)', () => {
  it('runs the handler inside a scope carrying the request header id', () => {
    const handler = withRequestContext((_req: Request) => getRequestContext()?.correlationId)
    const id = handler(new Request('https://x.test', { headers: { 'x-request-id': 'rid-7' } }))
    expect(id).toBe('rid-7')
  })

  it('mints an id when the request has no correlation header, preserving args', () => {
    const handler = withRequestContext(
      (_req: Request, extra: { params: string }) =>
        `${getRequestContext()?.correlationId ? 'has-id' : 'no-id'}:${extra.params}`,
    )
    const out = handler(new Request('https://x.test'), { params: 'p1' })
    expect(out).toBe('has-id:p1')
  })

  it('mints an id when the first arg is not a Request (no-arg handler)', () => {
    const handler = withRequestContext(() => getRequestContext()?.correlationId)
    const id = handler()
    expect(id).toBeTruthy()
  })
})

describe('withActionContext (server actions)', () => {
  it('wraps the action body in a scope with a correlation id', async () => {
    const action = withActionContext(() => Promise.resolve(getRequestContext()?.correlationId))
    expect(await action()).toBeTruthy()
  })

  it('reuses an outer scope id when nested', async () => {
    const inner = withActionContext(() => Promise.resolve(getRequestContext()?.correlationId))
    const outerId = await runWithRequestContext({ correlationId: 'outer' }, () => inner())
    expect(outerId).toBe('outer')
  })
})
