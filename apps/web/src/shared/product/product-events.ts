import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger } from '@/shared/lib/logger'
import 'server-only'

export type ProductEventName =
  'product_lookup' | 'product_search' | 'product_autocontributed' | 'product_contribution_deferred'

export type ProductLookupPayload = {
  readonly gtin14: string
  readonly result: 'hit' | 'miss'
  readonly source?: string
  readonly latencyMs: number
}

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
    logger.error('failed to record product event', {
      scope: 'emitProductEvent',
      event: event.event,
      err,
    })
  }
}
