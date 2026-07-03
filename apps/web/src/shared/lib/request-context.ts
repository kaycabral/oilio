import { AsyncLocalStorage } from 'node:async_hooks'

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
