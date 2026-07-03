import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * Per-request diagnostic context propagated implicitly through the call tree via
 * `AsyncLocalStorage` (brief 0086, Onda 3·C). A server boundary (server action /
 * route handler) opens a scope with a fresh `correlationId`; any code below —
 * including the `effect-bridge` defect log — reads it through the `logger` without
 * threading the id as a parameter. Node runtime only (Cloud Run standalone), never
 * edge; the store is empty at boot (`instrumentation.ts`), where the getter simply
 * returns `undefined` and the logger degrades to a line without a correlation id.
 *
 * This is DIAGNOSTIC metadata (error/trace), NOT product analytics — the `track()`
 * seam covers that other axis (brief 0086 § Fora).
 */
export type RequestContext = {
  readonly correlationId: string
  readonly orgId?: string
}

const store = new AsyncLocalStorage<RequestContext>()

/** Run `fn` with `ctx` as the active request context for its whole async subtree. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn)
}

/** The active request context, or `undefined` outside any scope (e.g. boot). */
export function getRequestContext(): RequestContext | undefined {
  return store.getStore()
}

// Correlation-id derivation (brief 0086 AC-05): reuse an upstream id when the
// edge/LB already stamped one, so a single request keeps ONE id across hops.
// Cloud Run injects `x-cloud-trace-context` (`TRACE_ID/SPAN_ID;o=1`); `traceparent`
// is the W3C form; `x-request-id` a common convention. Next documents none of
// these as guaranteed, so we read whatever the infra set and fall back to a fresh
// UUID when absent. Header lookup is case-insensitive (the `Headers` API lowercases).
export function correlationIdFromHeaders(headers: Headers): string {
  const cloudTrace = headers.get('x-cloud-trace-context')
  if (cloudTrace) {
    // `TRACE_ID/SPAN_ID;o=TRACE_TRUE` — the trace id is the part before `/`.
    const traceId = cloudTrace.split('/')[0]
    if (traceId) return traceId
  }
  const traceparent = headers.get('traceparent')
  if (traceparent) {
    // `version-traceid-spanid-flags` — the 32-hex trace id is the 2nd field.
    const traceId = traceparent.split('-')[1]
    if (traceId) return traceId
  }
  const requestId = headers.get('x-request-id')
  if (requestId) return requestId
  return randomUUID()
}

/**
 * Wrap a route handler (`app/api/**`) so its whole body runs inside a request
 * context scope (brief 0086 AC-04). Next 16 documents no central per-request
 * wrapper for handlers (nor AsyncLocalStorage continuity across proxy→handler),
 * so the guaranteed seam is wrapping the body — the DAL pattern the docs endorse.
 * Reuses an upstream correlation id when present, else mints one. Preserves the
 * handler's exact argument shape (`(req)`, `(req, {params})`, `()`).
 */
export function withRequestContext<Args extends unknown[], R>(
  handler: (...args: Args) => R,
): (...args: Args) => R {
  return (...args: Args): R => {
    // The first arg of a route handler is the Request (when present).
    const req = args[0]
    const headers = req instanceof Request ? req.headers : undefined
    const correlationId = headers ? correlationIdFromHeaders(headers) : randomUUID()
    return runWithRequestContext({ correlationId }, () => handler(...args))
  }
}

/**
 * Wrap a server action body so it runs inside a request context scope (brief 0086
 * AC-04). Next 16 exposes no central action interceptor and AsyncLocalStorage
 * cannot "open a scope and leave it open" past a helper's return — so a scope must
 * WRAP the body. Adoption is incremental: an action opts in by wrapping its body;
 * `orgId` enriches the context once resolved. Actions not yet wrapped still log
 * (without a correlation id) — the logger degrades clean.
 */
export function withActionContext<Args extends unknown[], R>(
  body: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return (...args: Args): Promise<R> => {
    const existing = getRequestContext()
    // Reuse an id from an outer scope (nested call) if present, else mint one.
    const correlationId = existing?.correlationId ?? randomUUID()
    return runWithRequestContext({ ...existing, correlationId }, () => body(...args))
  }
}
