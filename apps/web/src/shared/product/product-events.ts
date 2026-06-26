import { getEventStorePool } from '@/shared/db/pg/pool'
import 'server-only'

// Sovereign-base engine telemetry — brief 0050 (A2), namespace `product.*`.
//
// The base is CROSS-ORG: these events carry NO `orgId` and NO PII (canonical
// Event Catalog § "product"). They describe the engine's behavior over a GTIN
// — lookup result, auto-contribution, deferred contribution — for Wave 2 to
// aggregate hit-rate from.
//
// Transport (post-cutover, brief 0062): an append-only `product_events` table in
// the Postgres event store (the columns are the union of the four payloads; the
// irrelevant ones are null per event). When the vendor-neutral product-telemetry
// layer (`track()`, brief 0026) lands this becomes one adapter behind it; the
// call-sites only depend on `emitProductEvent`, so they stay unchanged.
//
// Best-effort by construction: telemetry must NEVER trap the registration flow
// (the best-effort invariant, AC-06) — a write failure is logged and swallowed.

export type ProductEventName =
  | 'product_lookup'
  | 'product_search'
  | 'product_autocontributed'
  | 'product_contribution_deferred'

// PII-free, org-free payloads. `gtin14` is a product key (not personal data).
export type ProductLookupPayload = {
  readonly gtin14: string
  readonly result: 'hit' | 'miss'
  readonly source?: string
  readonly latencyMs: number
}

// Name-autocomplete observability (feature D, brief 0055). NO PII and NO raw term
// — only the term LENGTH, the result count and latency. The base is cross-org, so
// no `orgId`. This is observability of the search boca, never a decision gate.
export type ProductSearchPayload = {
  readonly queryLen: number
  readonly resultCount: number
  readonly latencyMs: number
}

export type ProductAutocontributedPayload = {
  readonly gtin14: string
  readonly source: 'org-contributed'
}

export type ProductContributionDeferredPayload = {
  readonly gtin14: string
  readonly reason: 'unavailable' | 'timeout'
}

type ProductEventPayload =
  | ({ event: 'product_lookup' } & ProductLookupPayload)
  | ({ event: 'product_search' } & ProductSearchPayload)
  | ({ event: 'product_autocontributed' } & ProductAutocontributedPayload)
  | ({ event: 'product_contribution_deferred' } & ProductContributionDeferredPayload)

// Narrow the union to the columns each event populates; absent ones go null.
function columnsFor(event: ProductEventPayload): {
  gtin14: string | null
  result: string | null
  source: string | null
  latencyMs: number | null
  queryLen: number | null
  resultCount: number | null
  reason: string | null
} {
  const base = {
    gtin14: null as string | null,
    result: null as string | null,
    source: null as string | null,
    latencyMs: null as number | null,
    queryLen: null as number | null,
    resultCount: null as number | null,
    reason: null as string | null,
  }
  switch (event.event) {
    case 'product_lookup':
      return {
        ...base,
        gtin14: event.gtin14,
        result: event.result,
        source: event.source ?? null,
        latencyMs: event.latencyMs,
      }
    case 'product_search':
      return {
        ...base,
        queryLen: event.queryLen,
        resultCount: event.resultCount,
        latencyMs: event.latencyMs,
      }
    case 'product_autocontributed':
      return { ...base, gtin14: event.gtin14, source: event.source }
    case 'product_contribution_deferred':
      return { ...base, gtin14: event.gtin14, reason: event.reason }
  }
}

// Emit a product-engine event. Server-only; best-effort — a failure here must
// not bubble into the catalog write (the registration never breaks on the base).
export async function emitProductEvent(event: ProductEventPayload): Promise<void> {
  const c = columnsFor(event)
  try {
    await getEventStorePool().query(
      `INSERT INTO product_events
         (event, gtin14, result, source, latency_ms, query_len, result_count, reason, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.event,
        c.gtin14,
        c.result,
        c.source,
        c.latencyMs,
        c.queryLen,
        c.resultCount,
        c.reason,
        new Date().toISOString(),
      ],
    )
  } catch (err) {
    console.error(`[emitProductEvent] failed to record ${event.event}`, err)
  }
}
