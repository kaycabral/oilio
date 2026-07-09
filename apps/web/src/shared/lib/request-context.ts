import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type RequestContext = {
  readonly correlationId: string
  readonly orgId?: string
}

const store = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn)
}

export function getRequestContext(): RequestContext | undefined {
  return store.getStore()
}

export function correlationIdFromHeaders(headers: Headers): string {
  const cloudTrace = headers.get('x-cloud-trace-context')
  if (cloudTrace) {
    const traceId = cloudTrace.split('/')[0]
    if (traceId) return traceId
  }
  const traceparent = headers.get('traceparent')
  if (traceparent) {
    const traceId = traceparent.split('-')[1]
    if (traceId) return traceId
  }
  const requestId = headers.get('x-request-id')
  if (requestId) return requestId
  return randomUUID()
}

export function withRequestContext<Args extends unknown[], R>(
  handler: (...args: Args) => R,
): (...args: Args) => R {
  return (...args: Args): R => {
    const req = args[0]
    const headers = req instanceof Request ? req.headers : undefined
    const correlationId = headers ? correlationIdFromHeaders(headers) : randomUUID()
    return runWithRequestContext({ correlationId }, () => handler(...args))
  }
}

export function withActionContext<Args extends unknown[], R>(
  body: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return (...args: Args): Promise<R> => {
    const existing = getRequestContext()
    const correlationId = existing?.correlationId ?? randomUUID()
    return runWithRequestContext({ ...existing, correlationId }, () => body(...args))
  }
}
